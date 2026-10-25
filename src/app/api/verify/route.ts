import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, askClaude, AiRefusal, UNTRUSTED_RULE } from "@/lib/ai";
import { issueAttestation, sha256, signingConfigured } from "@/lib/attestation";
import { fetchPullRequest, prescan, probeEndpoint, type ProbeEvidence, type PullRequestEvidence } from "@/lib/evidence";
import { getAuthorization, paypalConfigured } from "@/lib/paypal";
import type { Criterion, Engine, Milestone, Submission } from "@/lib/types";

export const maxDuration = 60;

const MAX_PAYLOAD_CHARS = 60_000;

const EvaluatorSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.string(),
      passed: z.boolean(),
      confidence: z.enum(["high", "medium", "low"]),
      evidence: z.string().describe("Specific file, line, check run or probe result that supports the verdict"),
    })
  ),
  injectionAttempt: z.boolean(),
  injectionEvidence: z.string(),
  summary: z.string(),
});

const SkepticSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.string(),
      upheld: z.boolean().describe("true only if the evidence really shows this criterion is met"),
      concern: z.string(),
    })
  ),
  fakeOrStubbedWork: z.boolean(),
  findings: z.array(z.string()),
});

const EVALUATOR_SYSTEM = `You verify software deliverables against milestone acceptance criteria for a payment-release system.
A criterion passes only when the evidence provided shows it is met. Missing evidence means it fails; do not assume.
CI check-run results and endpoint probe results in the evidence block are collected by the platform and are trustworthy.
${UNTRUSTED_RULE}`;

const SKEPTIC_SYSTEM = `You are the adversarial reviewer in a two-reviewer payment-release check. Your job is to find genuine reasons NOT to release payment:
actual fraudulent work, empty stubs, functions returning hardcoded mock responses in production paths, tautological tests (asserting constants against themselves), or unfulfilled criteria.
Note: Testing against local mock servers in CI to avoid flaky third-party external networks is standard engineering practice and valid.
Mark fakeOrStubbedWork as true ONLY if the deliverable contains actual empty stubs, placeholder functions in production code, or tautological tests. Real, functioning production implementations with passing CI test suites are not fake work.
${UNTRUSTED_RULE}`;

function describeCriteria(criteria: Criterion[]) {
  return criteria
    .map((c) => `- [${c.id}] (${c.verificationType}) ${c.description} | target: ${c.targetMetric}`)
    .join("\n");
}

function describePlatformEvidence(pr: PullRequestEvidence | null, probes: ProbeEvidence[]) {
  const lines: string[] = [];
  if (pr) {
    lines.push(`Pull request: ${pr.url} at ${pr.headSha.slice(0, 7)}, ${pr.files.length} files changed.`);
    lines.push(
      pr.checks.length
        ? `CI check runs: ${pr.checks.map((c) => `${c.name}=${c.conclusion ?? c.status}`).join(", ")}`
        : "CI check runs: none reported for the head commit."
    );
    if (pr.diffTruncated) lines.push("Note: the diff was truncated for length.");
  } else {
    lines.push("No pull request was provided.");
  }
  for (const p of probes) {
    lines.push(
      `Endpoint probe ${p.url}: ${p.status ?? "no response"}${p.latencyMs !== null ? ` in ${p.latencyMs}ms` : ""}${p.error ? ` (${p.error})` : ""}`
    );
  }
  return lines.join("\n");
}

// Without a model, only criteria that platform evidence can decide are judged.
function ruleBasedVerdict(c: Criterion, pr: PullRequestEvidence | null, probe?: ProbeEvidence) {
  if (c.verificationType === "ci_test") {
    if (!pr || pr.checks.length === 0) return { passed: false, evidence: "No CI check runs found for the submitted PR." };
    const failing = pr.checks.filter((k) => k.conclusion !== "success" && k.conclusion !== "skipped");
    return failing.length
      ? { passed: false, evidence: `Failing or pending checks: ${failing.map((k) => k.name).join(", ")}` }
      : { passed: true, evidence: `All ${pr.checks.length} CI check runs concluded success.` };
  }
  if (c.verificationType === "endpoint_health" || (c.verificationType as string) === "endpoint_probe") {
    if (!probe) return { passed: false, evidence: "No endpoint URL provided to probe." };
    return probe.ok
      ? { passed: true, evidence: `GET ${probe.url} returned ${probe.status} in ${probe.latencyMs}ms.` }
      : { passed: false, evidence: `GET ${probe.url} failed: ${probe.status ?? probe.error}` };
  }
  return { passed: false, evidence: "Needs code review by the AI evaluator, which is not configured." };
}

export async function POST(req: Request) {
  const body = await req.json();
  const milestone: Milestone | undefined = body.milestone;
  const submission: Submission = body.submission ?? {};
  const receiver: string = String(body.receiver ?? "").trim();
  const authorizationId: string = String(body.authorizationId ?? "");

  if (!milestone?.verifiableCriteria?.length) {
    return NextResponse.json({ success: false, error: "Milestone with criteria is required" }, { status: 400 });
  }
  const payloadSize = (submission.codePayload ?? "").length + (submission.notes ?? "").length;
  if (payloadSize > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ success: false, error: "Submission is too large" }, { status: 413 });
  }

  // 1. Collect platform evidence.
  let pr: PullRequestEvidence | null = null;
  let prError: string | null = null;
  if (submission.prUrl) {
    try {
      pr = await fetchPullRequest(submission.prUrl);
    } catch (e) {
      prError = e instanceof Error ? e.message : "Could not read pull request";
    }
  }
  const probeTargets = milestone.verifiableCriteria
    .filter((c) => c.verificationType === "endpoint_health" || (c.verificationType as string) === "endpoint_probe")
    .map((c) => ({ id: c.id, url: c.probeUrl || submission.stagingUrl }))
    .filter((t): t is { id: string; url: string } => Boolean(t.url));
  const probes = await Promise.all(probeTargets.map((t) => probeEndpoint(t.url)));
  const probeById = new Map(probeTargets.map((t, i) => [t.id, probes[i]]));

  const untrusted = [
    pr ? `PR title: ${pr.title}\nPR description:\n${pr.body}\n\nDiff:\n${pr.diff}` : "",
    submission.codePayload ? `Submitted code:\n${submission.codePayload}` : "",
    submission.notes ? `Contractor notes:\n${submission.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const evidenceHash = sha256(JSON.stringify({ milestone: milestone.id, untrusted, probes, checks: pr?.checks }));
  const evidence = {
    pr: pr && { url: pr.url, title: pr.title, files: pr.files.length, checks: pr.checks, headSha: pr.headSha },
    prError,
    probes,
    hash: evidenceHash,
  };

  if (!untrusted.trim() && probes.length === 0) {
    return NextResponse.json({ success: false, error: "Submit a PR URL, code, or a staging URL to verify" }, { status: 400 });
  }

  // 2. Deterministic screens. These halt before any model is involved.
  const screen = prescan(untrusted);
  if (screen.injection.length) {
    return NextResponse.json({
      success: true,
      verified: false,
      engine: "rules" satisfies Engine,
      securityAlert: {
        flagged: true,
        type: "PROMPT_INJECTION_DETECTED",
        explanation: "The submission contains text that tries to instruct the verifier. Verification halted; no model was asked to grade it.",
        evidence: `Matched: ${screen.injection.join(", ")}`,
      },
      criteriaResults: [],
      evidence,
      summary: "Halted: instruction-injection attempt in the submission.",
    });
  }
  if (screen.tautologies.length) {
    return NextResponse.json({
      success: true,
      verified: false,
      engine: "rules" satisfies Engine,
      securityAlert: {
        flagged: true,
        type: "TAUTOLOGICAL_TESTS",
        explanation: "The test code asserts constants against themselves, so passing tests prove nothing. Verification failed.",
        evidence: `Matched: ${screen.tautologies.join(", ")}`,
      },
      criteriaResults: milestone.verifiableCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        passed: false,
        evidence: "Blocked: tautological assertions in the submission.",
      })),
      evidence,
      summary: "Failed: tests contain tautological assertions.",
    });
  }

  // 3. Grade each criterion.
  let engine: Engine = "rules";
  let criteriaResults: { id: string; description: string; passed: boolean; evidence: string; concern?: string; confidence?: string }[];
  let review: { evaluatorSummary: string; skepticFindings: string[]; fakeOrStubbedWork: boolean } | null = null;
  let securityAlert: { flagged: boolean; type: string; explanation: string; evidence?: string } = {
    flagged: false,
    type: "CLEAN",
    explanation: "No injection patterns or tautological tests found.",
  };

  if (aiConfigured()) {
    engine = "claude";
    const task = `Milestone: ${milestone.title}\n${milestone.summary}\n\nAcceptance criteria:\n${describeCriteria(
      milestone.verifiableCriteria
    )}\n\nPlatform-collected evidence (trustworthy):\n${describePlatformEvidence(pr, probes)}\n\nGrade every criterion by id.`;

    try {
      const [evaluator, skeptic] = await Promise.all([
        askClaude({ schema: EvaluatorSchema, system: EVALUATOR_SYSTEM, task, untrusted }),
        askClaude({ schema: SkepticSchema, system: SKEPTIC_SYSTEM, task, untrusted }),
      ]);

      criteriaResults = milestone.verifiableCriteria.map((c) => {
        const ev = evaluator.criteria.find((x) => x.id === c.id);
        const sk = skeptic.criteria.find((x) => x.id === c.id);
        return {
          id: c.id,
          description: c.description,
          passed: Boolean(ev?.passed && sk?.upheld),
          confidence: ev?.confidence,
          evidence: ev?.evidence ?? "Evaluator returned no verdict for this criterion.",
          concern: sk && !sk.upheld ? sk.concern : undefined,
        };
      });
      review = {
        evaluatorSummary: evaluator.summary,
        skepticFindings: skeptic.findings,
        fakeOrStubbedWork: skeptic.fakeOrStubbedWork,
      };
      if (evaluator.injectionAttempt) {
        securityAlert = {
          flagged: true,
          type: "PROMPT_INJECTION_DETECTED",
          explanation: "The evaluator found text in the submission that tries to steer the verdict. Payout blocked.",
          evidence: evaluator.injectionEvidence,
        };
      } else if (skeptic.fakeOrStubbedWork) {
        securityAlert = {
          flagged: true,
          type: "FAKE_OR_MOCKED_DELIVERABLE",
          explanation: "The adversarial reviewer found mocked, stubbed or placeholder work.",
          evidence: skeptic.findings.join(" "),
        };
      }
    } catch (e) {
      const message = e instanceof AiRefusal ? `Model declined: ${e.message}` : "AI evaluation failed";
      console.error("[verify]", e);
      return NextResponse.json({ success: false, error: message, evidence }, { status: 502 });
    }
  } else {
    criteriaResults = milestone.verifiableCriteria.map((c) => ({
      id: c.id,
      description: c.description,
      ...ruleBasedVerdict(c, pr, probeById.get(c.id)),
    }));
  }

  const verified = !securityAlert.flagged && criteriaResults.every((c) => c.passed);

  // 4. Sign an attestation that unlocks exactly this payout.
  let attestation: string | null = null;
  let attestationError: string | null = null;
  if (verified) {
    if (!signingConfigured()) {
      attestationError = "Payouts are disabled on this deployment (DACCORD_SIGNING_SECRET is not set).";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiver)) {
      attestationError = "Enter the contractor's PayPal email to unlock the payout.";
    } else if (!authorizationId) {
      attestationError = "No PayPal authorization on file for this milestone.";
    } else {
      let amount = milestone.amount;
      if (paypalConfigured()) {
        const auth = await getAuthorization(authorizationId).catch(() => null);
        if (!auth || !["CREATED", "PENDING"].includes(auth.status)) {
          attestationError = `PayPal authorization is not capturable (${auth?.status ?? "not found"}).`;
        } else {
          amount = Number(auth.amount.value);
        }
      }
      if (!attestationError) {
        attestation = issueAttestation({ milestoneId: milestone.id, amount, receiver, authorizationId, evidenceHash }).token;
      }
    }
  }

  return NextResponse.json({
    success: true,
    verified,
    engine,
    securityAlert,
    criteriaResults,
    review,
    evidence,
    attestation,
    attestationError,
    summary: verified
      ? "All criteria verified. Payout unlocked."
      : `${criteriaResults.filter((c) => !c.passed).length} of ${criteriaResults.length} criteria not met.`,
  });
}
