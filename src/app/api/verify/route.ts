import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, askClaude, AiRefusal } from "@/lib/ai";
import { issueAttestation, sha256, signingConfigured } from "@/lib/attestation";
import {
  checkAttempt,
  getVerdict,
  GRANT_LIFETIME_LIMIT,
  GRANT_LIFETIME_SEC,
  LAB_GLOBAL_LIMIT,
  rememberVerdict,
  storageMode,
} from "@/lib/attempts";
import { clipName, fetchPullRequest, prescan, probeEndpoint, type ProbeEvidence, type PullRequestEvidence } from "@/lib/evidence";
import { grantMilestone, grantReviewWindowSec, readGrant } from "@/lib/grant";
import { getAuthorization, paypalConfigured } from "@/lib/paypal";
import { EVALUATOR_SYSTEM, SKEPTIC_SYSTEM } from "@/lib/prompts";
import { openReview, reviewBlocker, WINDOW_DISABLED_NOTE, windowEnabled } from "@/lib/release";
import type { Criterion, Engine, Grant, Milestone, Submission } from "@/lib/types";

export const maxDuration = 60;

const MAX_PAYLOAD_CHARS = 60_000;
const MAX_LAB_CRITERIA = 20;
const MAX_LAB_MILESTONE_CHARS = 20_000;

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

type CriterionResult = {
  id: string;
  description: string;
  passed: boolean;
  evidence: string;
  concern?: string;
  confidence?: string;
};

type SecurityAlert = { flagged: boolean; type: string; explanation: string; evidence?: string };

const isEndpoint = (c: Criterion) =>
  c.verificationType === "endpoint_health" || (c.verificationType as string) === "endpoint_probe";

/** CI checks count only when GitHub Actions produced them; other apps (deploy previews, status APIs) are listed but prove nothing about tests. */
const isActionsCheck = (k: PullRequestEvidence["checks"][number]) => k.app === "github-actions";
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

function describeCriteria(criteria: Criterion[]) {
  return criteria
    .map((c) => `- [${c.id}] (${c.verificationType}) ${c.description} | target: ${c.targetMetric}`)
    .join("\n");
}

function describePlatformEvidence(
  pr: PullRequestEvidence | null,
  prError: string | null,
  probes: { id: string; probe: ProbeEvidence | null }[]
) {
  const lines: string[] = [];
  if (pr) {
    // Names below are quoted with JSON.stringify: they are written by the
    // contractor (job names, file names), so they are labels, not facts.
    lines.push(
      `Pull request: ${pr.url} at ${pr.headSha.slice(0, 7)}, targeting repository ${JSON.stringify(pr.baseRepo)} (state: ${pr.state}${
        pr.merged ? ", merged" : ""
      }), ${pr.changedFilesTotal} files changed.`
    );
    lines.push(
      pr.checks.length
        ? `CI check runs on the head commit (contractor-chosen name: conclusion, app): ${pr.checks
            .map((c) => `${JSON.stringify(clipName(c.name))}: ${c.conclusion ?? c.status}, app ${c.app ?? "unknown"}`)
            .join("; ")}`
        : "CI check runs: none reported for the head commit."
    );
    lines.push(
      pr.workflows.length
        ? `Workflow files at the head commit (contractor-chosen file names; contents are in the untrusted block): ${pr.workflows
            .map((w) => JSON.stringify(clipName(w.path)))
            .join(", ")}${pr.workflowsTruncated ? " (some were cut or not read because of the size cap)" : ""}`
        : "Workflow files: none found at the head commit, so no green check can be tied to a workflow."
    );
    if (pr.workflowsError) lines.push(`Workflow files could not all be read: ${clipName(pr.workflowsError)}`);
    lines.push(
      pr.buildFiles.length
        ? `Build files read at the head commit (contents are in the untrusted block): ${pr.buildFiles
            .map((f) => JSON.stringify(clipName(f.path)))
            .join(", ")}`
        : "Build files: no package.json, Makefile or local action was found, so project test scripts are not defined in the evidence."
    );
    if (pr.buildFilesNote) lines.push(`Build files not fully read: ${clipName(pr.buildFilesNote)}`);
    if (pr.workflowsChangedInPr) {
      lines.push("Warning: this pull request changes files under .github/, so it may change what CI runs. Read those changes in the diff.");
    }
  } else {
    lines.push(prError ? `The pull request could not be read: ${prError}` : "No pull request was provided.");
  }
  for (const { id, probe } of probes) {
    lines.push(
      probe
        ? `Endpoint probe for [${id}] ${probe.url}: ${probe.status ?? "no response"}${
            probe.latencyMs !== null ? ` in ${probe.latencyMs}ms` : ""
          }${probe.error ? ` (${probe.error})` : ""}`
        : `Endpoint probe for [${id}]: not run, because no probe URL was agreed at funding.`
    );
  }
  return lines.join("\n");
}

/**
 * Facts the platform can decide without a model. They override a model pass:
 * a model can fail these criteria for other reasons, but never pass them
 * against the platform's own evidence.
 */
function platformVeto(c: Criterion, pr: PullRequestEvidence | null, probe: ProbeEvidence | null | undefined): string | null {
  if (c.verificationType === "ci_test") {
    if (!pr) return "No pull request was read, so there are no CI runs to check.";
    const actions = pr.checks.filter(isActionsCheck);
    if (actions.length === 0) return "No GitHub Actions check runs on the head commit. Checks from other apps do not prove tests ran.";
    const failing = actions.filter((k) => k.status !== "completed" || !PASSING_CONCLUSIONS.has(k.conclusion ?? ""));
    if (failing.length) return `Failing or pending GitHub Actions checks: ${failing.map((k) => k.name).join(", ")}`;
    if (!actions.some((k) => k.conclusion === "success")) return "No GitHub Actions check concluded success.";
    if (pr.workflows.length === 0) return "No workflow file was found at the head commit, so nobody can see what the green checks ran.";
    const unread = pr.workflows.filter((w) => /^\[(not read|unreadable)/.test(w.content)).map((w) => clipName(w.path));
    if (pr.workflowsTruncated || pr.workflowsError || unread.length) {
      return `Not every workflow file could be read in full${unread.length ? ` (${unread.join(", ")})` : ""}, so nobody can see what the green checks ran.`;
    }
  }
  if (isEndpoint(c)) {
    if (probe === null || probe === undefined) return "No probe URL was agreed at funding, so this endpoint cannot be checked.";
    if (!probe.ok) return `GET ${probe.url} failed: ${probe.status ?? probe.error}`;
  }
  return null;
}

// Without a model nobody reads the code or the CI workflow, so nothing can
// pass. The platform facts are still reported so the contractor sees them.
function ruleBasedVerdict(c: Criterion, pr: PullRequestEvidence | null, probe: ProbeEvidence | null | undefined) {
  const veto = platformVeto(c, pr, probe);
  if (veto) return { passed: false, evidence: veto };
  if (c.verificationType === "ci_test") {
    const n = pr?.checks.filter(isActionsCheck).length ?? 0;
    return {
      passed: false,
      evidence: `${n} GitHub Actions checks are green, but without the AI reviewer nobody read what the workflow runs.`,
    };
  }
  if (isEndpoint(c) && probe) {
    return {
      passed: false,
      evidence: `GET ${probe.url} returned ${probe.status} in ${probe.latencyMs}ms, but without the AI reviewer nobody read the handler behind it.`,
    };
  }
  return { passed: false, evidence: "Needs code review by the AI evaluator, which is not configured." };
}

// Prefer headers the host sets itself. On Vercel x-vercel-forwarded-for and
// x-real-ip come from the platform; a client-sent x-forwarded-for is the last resort.
function clientKey(req: Request): string {
  const first = (h: string) => req.headers.get(h)?.split(",")[0]?.trim();
  return first("x-vercel-forwarded-for") || first("x-real-ip") || first("x-forwarded-for") || "unknown";
}

/** Light shape check for the grading-only (Threat lab) path, where the milestone comes from the body. */
function labMilestone(raw: unknown): Milestone | null {
  const m = raw as Milestone | undefined;
  if (!m || typeof m !== "object" || typeof m.id !== "string" || !Array.isArray(m.verifiableCriteria)) return null;
  if (m.verifiableCriteria.length === 0 || m.verifiableCriteria.length > MAX_LAB_CRITERIA) return null;
  if (JSON.stringify(m).length > MAX_LAB_MILESTONE_CHARS) return null;
  return m;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const submission: Submission = body.submission ?? {};

  // The grant is the client's signed terms from the moment the funds were held.
  // When it is present, the milestone, amount, payee, authorization and staging
  // URL come only from it; the matching body fields are ignored.
  let grant: Grant | null = null;
  let milestone: Milestone | null;
  if (body.grant !== undefined && body.grant !== null) {
    grant = readGrant(body.grant);
    if (!grant) {
      return NextResponse.json(
        { success: false, error: "The milestone grant is invalid or expired. Hold the funds again to get a new one." },
        { status: 403 }
      );
    }
    milestone = grantMilestone(grant);
  } else {
    milestone = labMilestone(body.milestone);
    if (!milestone) {
      return NextResponse.json({ success: false, error: "Milestone with criteria is required" }, { status: 400 });
    }
  }
  const gradingOnly = !grant;

  const payloadSize = String(submission.codePayload ?? "").length + String(submission.notes ?? "").length;
  if (payloadSize > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ success: false, error: "Submission is too large" }, { status: 413 });
  }
  if (grant && !submission.prUrl) {
    return NextResponse.json(
      { success: false, error: "Submit the pull request URL. Pasted code alone cannot unlock a payout." },
      { status: 400 }
    );
  }

  // 1. Collect platform evidence. Probes go only to URLs the client agreed to
  // at funding: the criterion's own probe URL, else the grant's staging URL.
  // A staging URL in the submission is never probed. Grading-only calls (the
  // Threat lab) grade pasted text only: no GitHub calls and no probes, so an
  // unauthenticated caller cannot spend the GitHub quota or aim requests.
  let pr: PullRequestEvidence | null = null;
  let prError: string | null = null;
  if (grant) {
    try {
      pr = await fetchPullRequest(String(submission.prUrl));
    } catch (e) {
      prError = e instanceof Error ? e.message : "Could not read pull request";
    }
    if (!pr) {
      return NextResponse.json(
        {
          success: false,
          error: `The pull request could not be read (${prError ?? "unknown error"}). A payout needs a public GitHub PR the verifier can read.`,
        },
        { status: 422 }
      );
    }
    if (grant.repo && pr.baseRepo.toLowerCase() !== grant.repo.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: `This pull request targets ${pr.baseRepo}, but the client funded work on ${grant.repo}. Submit a PR to that repository.`,
        },
        { status: 403 }
      );
    }
    if (pr.state === "closed" && !pr.merged) {
      return NextResponse.json(
        { success: false, error: "This pull request was closed without being merged. Submit an open or merged PR." },
        { status: 422 }
      );
    }
    // A milestone that was paid, escalated, or is waiting for a new commit after
    // the client's objection cannot open a review window, so do not spend model
    // calls grading it.
    if (windowEnabled()) {
      let blocker: string | null = null;
      try {
        blocker = await reviewBlocker(grant, pr.headSha);
      } catch (e) {
        console.error("[verify] review store unavailable", e);
        return NextResponse.json(
          { success: false, error: "The review datastore is unavailable. Try again shortly." },
          { status: 503 }
        );
      }
      if (blocker) return NextResponse.json({ success: false, error: blocker }, { status: 409 });
    }
  }
  const probeTargets = milestone.verifiableCriteria
    .filter(isEndpoint)
    .map((c) => ({ id: c.id, url: grant ? c.probeUrl || grant.stagingUrl || null : null }));
  const probeResults = await Promise.all(probeTargets.map((t) => (t.url ? probeEndpoint(t.url) : Promise.resolve(null))));
  const probeById = new Map(probeTargets.map((t, i) => [t.id, probeResults[i]]));
  const probes = probeResults.filter((p): p is ProbeEvidence => p !== null);

  const untrusted = [
    pr ? `PR title: ${pr.title}\nPR description:\n${pr.body}\n\nDiff:\n${pr.diff}` : "",
    pr?.workflows.length
      ? `CI workflow files at the PR head commit (written by the contractor):\n${pr.workflows
          .map((w) => `--- ${clipName(w.path)} ---\n${w.content}`)
          .join("\n\n")}`
      : "",
    pr?.buildFiles.length
      ? `Build files at the PR head commit that define what the CI commands run (written by the contractor):\n${pr.buildFiles
          .map((f) => `--- ${clipName(f.path)} ---\n${f.content}`)
          .join("\n\n")}`
      : "",
    submission.codePayload
      ? `Code pasted by the contractor (not read from the repository, so it is a claim, not proof of what was delivered):\n${submission.codePayload}`
      : "",
    submission.notes ? `Contractor notes:\n${submission.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // The hash binds the verdict to the exact terms and evidence. It includes the
  // grant (so each hold gets its own payout batch id) and leaves out probe
  // latency (so identical evidence hashes the same and a repeat is recognized).
  const evidenceHash = sha256(
    JSON.stringify({
      terms: grant
        ? { authorizationId: grant.authorizationId, issuedAt: grant.issuedAt, milestone: grant.milestone, receiver: grant.receiver, amount: grant.amount }
        : { gradingOnly: true, milestone: { id: milestone.id, verifiableCriteria: milestone.verifiableCriteria } },
      headSha: pr?.headSha ?? null,
      untrusted,
      checks: pr?.checks ?? null,
      probes: probes.map((p) => ({ url: p.url, ok: p.ok, status: p.status })),
    })
  );
  // Remembered failures are keyed on what the contractor cannot cheaply change:
  // the grant, the commit, its checks and the probes. Notes and pasted code are
  // left out, so editing a note does not buy a fresh roll on the same commit.
  const verdictKey = grant
    ? sha256(
        JSON.stringify({
          v: 2,
          authorizationId: grant.authorizationId,
          issuedAt: grant.issuedAt,
          headSha: pr?.headSha ?? null,
          checks: pr?.checks ?? null,
          probes: probes.map((p) => ({ url: p.url, ok: p.ok, status: p.status })),
        })
      )
    : null;
  const evidence = {
    pr: pr && {
      url: pr.url,
      title: pr.title,
      files: pr.changedFilesTotal,
      checks: pr.checks,
      headSha: pr.headSha,
      repo: pr.baseRepo,
      workflows: pr.workflows.map((w) => w.path),
      buildFiles: pr.buildFiles.map((f) => f.path),
      workflowsChangedInPr: pr.workflowsChangedInPr,
    },
    prError,
    probes,
    hash: evidenceHash,
  };
  const storage = storageMode();
  const base = {
    success: true as const,
    mode: gradingOnly ? ("grading_only" as const) : ("grant" as const),
    storage,
    evidence,
  };
  const noAttestation = gradingOnly
    ? "Grading only: payouts need a milestone that was signed when the funds were held."
    : null;

  if (!untrusted.trim() && probes.length === 0) {
    return NextResponse.json({ success: false, error: "Submit a PR URL or code to verify" }, { status: 400 });
  }

  // 2. Deterministic screens. These halt before any model is involved.
  if (pr && (pr.diffTruncated || pr.tooManyFiles || pr.unreviewable.length)) {
    const unseen = [
      ...pr.unreviewable,
      ...pr.truncatedFiles,
      ...(pr.tooManyFiles ? [`${pr.changedFilesTotal - pr.files.length} files past the first ${pr.files.length}`] : []),
    ];
    return NextResponse.json({
      ...base,
      verified: false,
      engine: "rules" satisfies Engine,
      securityAlert: {
        flagged: true,
        type: "UNREVIEWABLE_SUBMISSION",
        explanation:
          "Part of this pull request cannot be shown to the reviewers (too large, too many files, or no readable diff), and unseen code cannot pass. Split the milestone into a smaller PR.",
        evidence: `Unseen: ${unseen.slice(0, 20).join(", ")}${unseen.length > 20 ? ` and ${unseen.length - 20} more` : ""}`,
      },
      criteriaResults: milestone.verifiableCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        passed: false,
        evidence: "Not graded: part of the pull request could not be reviewed.",
      })),
      attestation: null,
      attestationError: noAttestation,
      summary: "Failed: the pull request is too large to review in full. Split it into a smaller PR.",
    });
  }

  // Contractor-chosen names that reach the trusted block are screened too.
  const screen = prescan(
    [untrusted, ...(pr?.checks.map((c) => c.name) ?? []), ...(pr?.workflows.map((w) => w.path) ?? [])].join("\n")
  );
  if (screen.injection.length) {
    return NextResponse.json({
      ...base,
      verified: false,
      engine: "rules" satisfies Engine,
      securityAlert: {
        flagged: true,
        type: "PROMPT_INJECTION_DETECTED",
        explanation: "The submission contains text that tries to instruct the verifier. Verification halted; no model was asked to grade it.",
        evidence: `Matched: ${screen.injection.join(", ")}`,
      },
      criteriaResults: [],
      attestation: null,
      attestationError: noAttestation,
      summary: "Halted: instruction-injection attempt in the submission.",
    });
  }
  if (screen.tautologies.length) {
    return NextResponse.json({
      ...base,
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
      attestation: null,
      attestationError: noAttestation,
      summary: "Failed: tests contain tautological assertions.",
    });
  }

  // 3. Retry limits. A commit that already failed under this grant is answered
  // from memory, so it cannot be rerolled until both passes happen to agree.
  // Grading-only calls sign nothing, so they skip this and are capped by the
  // per-client and per-deployment limits below instead.
  const previous = verdictKey ? await getVerdict(verdictKey) : null;
  if (previous) {
    return NextResponse.json({
      ...base,
      verified: false,
      engine: "rules" satisfies Engine,
      securityAlert: {
        flagged: true,
        type: "ALREADY_FAILED",
        explanation:
          "This commit already failed verification under this hold. Sending it again cannot change the verdict; push a fix to the PR first.",
        evidence: `Earlier verdict (${previous.at}): ${previous.summary}`,
      },
      criteriaResults: [],
      attestation: null,
      attestationError: noAttestation,
      summary: "Criteria not met: this commit already failed once.",
    });
  }

  let attempt: Awaited<ReturnType<typeof checkAttempt>> | null = null;
  if (aiConfigured()) {
    const limited = (check: Awaited<ReturnType<typeof checkAttempt>>, what: string) => {
      const minutes = Math.ceil(check.retryAfterSec / 60);
      const wait =
        minutes > 120 ? `about ${Math.ceil(minutes / 1440)} day(s)` : `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
      return NextResponse.json(
        {
          success: false,
          error: `Too many verification attempts (${check.limit} ${what}). Try again in ${wait}.`,
          retryAfterSec: check.retryAfterSec,
          storage,
          evidence,
        },
        { status: 429, headers: { "Retry-After": String(check.retryAfterSec) } }
      );
    };
    if (grant) {
      attempt = await checkAttempt(`grant:${grant.authorizationId}`);
      if (!attempt.allowed) return limited(attempt, "per hour per milestone");
      const lifetime = await checkAttempt(`grant-life:${grant.authorizationId}`, {
        limit: GRANT_LIFETIME_LIMIT,
        windowSec: GRANT_LIFETIME_SEC,
      });
      if (!lifetime.allowed) return limited(lifetime, "per hold in total");
    } else {
      attempt = await checkAttempt(`lab:${clientKey(req)}`);
      if (!attempt.allowed) return limited(attempt, "per hour");
      const global = await checkAttempt("lab:global", { limit: LAB_GLOBAL_LIMIT });
      if (!global.allowed) return limited(global, "per hour for the Threat lab on this site");
    }
  }

  // 4. Grade each criterion.
  let engine: Engine = "rules";
  let criteriaResults: CriterionResult[];
  let review: { evaluatorSummary: string; skepticFindings: string[]; fakeOrStubbedWork: boolean } | null = null;
  let securityAlert: SecurityAlert = {
    flagged: false,
    type: "CLEAN",
    explanation: "No injection patterns or tautological tests found.",
  };

  if (aiConfigured()) {
    engine = "claude";
    const task = `Milestone: ${milestone.title}\n${milestone.summary}\n\nAcceptance criteria:\n${describeCriteria(
      milestone.verifiableCriteria
    )}\n\nPlatform-collected evidence (trustworthy):\n${describePlatformEvidence(
      pr,
      prError,
      probeTargets.map((t) => ({ id: t.id, probe: probeById.get(t.id) ?? null }))
    )}\n\nGrade every criterion by id.`;

    try {
      const [evaluator, skeptic] = await Promise.all([
        askClaude({ schema: EvaluatorSchema, system: EVALUATOR_SYSTEM, task, untrusted }),
        askClaude({ schema: SkepticSchema, system: SKEPTIC_SYSTEM, task, untrusted }),
      ]);

      criteriaResults = milestone.verifiableCriteria.map((c) => {
        const ev = evaluator.criteria.find((x) => x.id === c.id);
        const sk = skeptic.criteria.find((x) => x.id === c.id);
        const veto = platformVeto(c, pr, probeById.get(c.id));
        return {
          id: c.id,
          description: c.description,
          passed: Boolean(ev?.passed && sk?.upheld) && !veto,
          confidence: ev?.confidence,
          evidence: veto ?? ev?.evidence ?? "Evaluator returned no verdict for this criterion.",
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
      return NextResponse.json({ success: false, error: message, evidence, storage }, { status: 502 });
    }
  } else {
    criteriaResults = milestone.verifiableCriteria.map((c) => ({
      id: c.id,
      description: c.description,
      ...ruleBasedVerdict(c, pr, probeById.get(c.id)),
    }));
  }

  const verified = !securityAlert.flagged && criteriaResults.every((c) => c.passed);
  const failedCount = criteriaResults.filter((c) => !c.passed).length;
  const summary = verified
    ? gradingOnly
      ? "All criteria verified. Grading only, so no payout is unlocked."
      : "All criteria verified. Payout unlocked."
    : `${failedCount} of ${criteriaResults.length} criteria not met.`;

  if (!verified && engine === "claude" && verdictKey) {
    const failedIds = criteriaResults.filter((c) => !c.passed).map((c) => c.id);
    await rememberVerdict(verdictKey, {
      verified: false,
      summary: securityAlert.flagged
        ? `${securityAlert.type}: ${securityAlert.explanation}`
        : `${summary} Failed: ${failedIds.join(", ")}.`,
    });
  }

  // 5. Release. With the review window on, a pass opens the client's review
  // window and no attestation is signed (so /api/payout cannot skip the
  // window). Without it (production with no datastore) a pass signs a 30-minute
  // attestation that unlocks exactly this payout, as before. Either way only a
  // grant can unlock funds, and every payout field comes from the grant.
  let attestation: string | null = null;
  let attestationError: string | null = noAttestation;
  let windowReview: { windowEnabled: boolean; releaseAt: number | null; reviewWindowSec: number } | null = null;
  let reviewError: string | null = null;
  let reviewNote: string | null = null;
  if (verified && grant) {
    if (!signingConfigured()) {
      attestationError = "Payouts are disabled on this deployment (DACCORD_SIGNING_SECRET is not set).";
    } else {
      if (paypalConfigured() && grant.mode === "paypal" && !grant.authorizationId.startsWith("SIM-")) {
        const auth = await getAuthorization(grant.authorizationId).catch(() => null);
        if (!auth || !["CREATED", "PENDING"].includes(auth.status)) {
          attestationError = `PayPal authorization is not capturable (${auth?.status ?? "not found"}).`;
        } else if (Math.abs(Number(auth.amount.value) - grant.amount) > 0.005) {
          attestationError = "The PayPal authorization amount no longer matches the funded milestone.";
        }
      }
      if (!attestationError && windowEnabled()) {
        try {
          const opened = await openReview(grant, { evidenceHash, headSha: pr?.headSha ?? null });
          if (opened.ok) {
            windowReview = { windowEnabled: true, releaseAt: opened.record.releaseAt, reviewWindowSec: opened.record.reviewWindowSec };
            reviewNote = opened.note ?? null;
          } else {
            reviewError = opened.error;
          }
        } catch (e) {
          console.error("[verify] could not open review window", e);
          reviewError = "The review datastore is unavailable, so no review window was opened. Verify again shortly.";
        }
        if (reviewError) windowReview = { windowEnabled: true, releaseAt: null, reviewWindowSec: grantReviewWindowSec(grant) };
        attestationError = reviewError;
      } else if (!attestationError) {
        attestation = issueAttestation({
          milestoneId: grant.milestone.id,
          amount: grant.amount,
          receiver: grant.receiver,
          authorizationId: grant.authorizationId,
          evidenceHash,
        }).token;
        windowReview = { windowEnabled: false, releaseAt: null, reviewWindowSec: grantReviewWindowSec(grant) };
        reviewNote = WINDOW_DISABLED_NOTE;
      }
    }
  }
  const finalSummary =
    verified && windowReview?.releaseAt
      ? "All criteria verified. The client's review window is open."
      : verified && grant && !attestation
        ? "All criteria verified, but no payment can be released yet."
        : summary;

  return NextResponse.json({
    ...base,
    verified,
    engine,
    securityAlert,
    criteriaResults,
    // One object: the reviewers' findings (evaluatorSummary, skepticFindings,
    // fakeOrStubbedWork) when a model graded, plus the review window
    // (windowEnabled, releaseAt, reviewWindowSec) on a verified grant.
    review: review || windowReview ? { ...(review ?? {}), ...(windowReview ?? {}) } : null,
    attempts: attempt ? { used: attempt.count, limit: attempt.limit } : null,
    attestation,
    attestationError,
    reviewError,
    reviewNote,
    summary: finalSummary,
  });
}
