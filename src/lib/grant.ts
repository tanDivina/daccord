import { sha256, signToken, verifyToken } from "./attestation";
import type { Criterion, Grant, GrantMilestone, Milestone, VerificationType } from "./types";

// A milestone grant binds the client's terms (criteria, probe URLs, payee,
// staging URL) to one PayPal authorization. The client sets them before the
// hold; the freelancer only ever sees the signed result and cannot change it.

const GRANT_KIND = "grant";
/** PayPal keeps an authorization valid for 29 days, so a grant never outlives it. */
export const GRANT_TTL_MS = 29 * 86_400_000;

const VERIFICATION_TYPES: VerificationType[] = ["ci_test", "ast_analysis", "endpoint_health", "ui_contract"];
const MAX_CRITERIA = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same rules as the evidence probe: https, public hostname, no IPs or internal names. */
export function isPublicHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname;
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  if (/(^|\.)(localhost|internal|local)$/.test(host)) return null;
  if (url.username || url.password) return null;
  return url;
}

const REPO_RE = /^([\w.-]{1,100})\/([\w.-]{1,100})$/;

/** Accepts "owner/name" or a github.com repo URL; returns "owner/name" or null. */
export function normalizeRepo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = s.match(REPO_RE);
  if (!m || /^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) return null;
  s = `${m[1]}/${m[2]}`;
  return s;
}

export function isEmail(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length <= 254 && EMAIL_RE.test(raw);
}

/** What the client supplies before the hold. */
export interface GrantInput {
  milestone: GrantMilestone;
  receiver: string;
  stagingUrl?: string;
  /** "owner/name": the PR must target this repository. */
  repo?: string;
  contractTitle?: string;
}

export interface IssueGrantInput extends GrantInput {
  amount: number;
  authorizationId: string;
  mode?: Grant["mode"];
  /** Optional earlier expiry, e.g. PayPal's authorization expiration_time. */
  expiresAt?: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

function parseCriterion(raw: unknown, i: number): Parsed<Criterion> {
  if (!raw || typeof raw !== "object") return { ok: false, error: `Criterion ${i + 1} is malformed` };
  const c = raw as Record<string, unknown>;
  const id = str(c.id, 64);
  const description = str(c.description, 1000);
  const targetMetric = str(c.targetMetric, 500);
  const verificationType = c.verificationType as VerificationType;
  if (!id || !description || !targetMetric || !VERIFICATION_TYPES.includes(verificationType)) {
    return { ok: false, error: `Criterion ${i + 1} is missing an id, description, metric or valid type` };
  }
  const criterion: Criterion = { id, description, verificationType, targetMetric };
  if (c.probeUrl !== undefined && c.probeUrl !== null && c.probeUrl !== "") {
    const url = isPublicHttpsUrl(c.probeUrl);
    if (!url) return { ok: false, error: `Criterion ${i + 1} probe URL must be https on a public host` };
    criterion.probeUrl = url.toString();
  }
  return { ok: true, value: criterion };
}

/** Validates and normalizes the client's milestone terms, payee and staging URL. */
export function parseGrantInput(body: {
  milestone?: unknown;
  receiver?: unknown;
  stagingUrl?: unknown;
  repo?: unknown;
  contractTitle?: unknown;
}): Parsed<GrantInput> {
  const m = body.milestone as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return { ok: false, error: "milestone is required" };
  const id = str(m.id, 128);
  const title = str(m.title, 200);
  const summary = typeof m.summary === "string" ? m.summary.trim().slice(0, 2000) : "";
  if (!id || !title) return { ok: false, error: "Milestone needs an id and a title" };
  if (!Array.isArray(m.verifiableCriteria) || m.verifiableCriteria.length === 0) {
    return { ok: false, error: "Milestone needs at least one criterion" };
  }
  if (m.verifiableCriteria.length > MAX_CRITERIA) {
    return { ok: false, error: `At most ${MAX_CRITERIA} criteria per milestone` };
  }
  const criteria: Criterion[] = [];
  for (let i = 0; i < m.verifiableCriteria.length; i++) {
    const c = parseCriterion(m.verifiableCriteria[i], i);
    if (!c.ok) return c;
    criteria.push(c.value);
  }

  const receiver = typeof body.receiver === "string" ? body.receiver.trim().toLowerCase() : "";
  if (!isEmail(receiver)) return { ok: false, error: "Enter the contractor's PayPal email" };

  let stagingUrl: string | undefined;
  if (body.stagingUrl !== undefined && body.stagingUrl !== null && body.stagingUrl !== "") {
    const url = isPublicHttpsUrl(typeof body.stagingUrl === "string" ? body.stagingUrl.trim() : body.stagingUrl);
    if (!url) return { ok: false, error: "Staging URL must be https on a public host" };
    stagingUrl = url.toString();
  }

  // An endpoint criterion with no probe URL of its own is checked against the
  // staging URL, so without one it could never pass. Ask for it now, before the hold.
  const needsStaging = criteria.some(
    (c) => (c.verificationType === "endpoint_health" || (c.verificationType as string) === "endpoint_probe") && !c.probeUrl
  );
  if (needsStaging && !stagingUrl) {
    return { ok: false, error: "This milestone has a health check, so enter the staging URL before holding the funds" };
  }

  let repo: string | undefined;
  if (body.repo !== undefined && body.repo !== null && body.repo !== "") {
    const r = normalizeRepo(body.repo);
    if (!r) return { ok: false, error: "Repository must look like owner/name" };
    repo = r;
  }

  const contractTitle = str(body.contractTitle, 200) ?? undefined;
  return {
    ok: true,
    value: { milestone: { id, title, summary, verifiableCriteria: criteria }, receiver, stagingUrl, repo, contractTitle },
  };
}

/**
 * A short hash of the client's terms. The create route puts it in the PayPal
 * order's reference_id; the authorize route recomputes it, so whoever later
 * holds the order ID cannot get a grant with different terms or payee.
 */
export function grantCommitment(input: GrantInput): string {
  const canonical = JSON.stringify({
    milestone: {
      id: input.milestone.id,
      title: input.milestone.title,
      summary: input.milestone.summary,
      verifiableCriteria: input.milestone.verifiableCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        verificationType: c.verificationType,
        targetMetric: c.targetMetric,
        probeUrl: c.probeUrl ?? null,
      })),
    },
    receiver: input.receiver,
    stagingUrl: input.stagingUrl ?? null,
    repo: input.repo ? input.repo.toLowerCase() : null,
    contractTitle: input.contractTitle ?? null,
  });
  return `dk1-${sha256(canonical)}`;
}

export function issueGrant(input: IssueGrantInput): string {
  const now = Date.now();
  const cap = now + GRANT_TTL_MS;
  const expiresAt =
    input.expiresAt && Number.isFinite(input.expiresAt) && input.expiresAt > now ? Math.min(input.expiresAt, cap) : cap;
  const grant: Grant = {
    v: 1,
    milestone: input.milestone,
    amount: input.amount,
    authorizationId: input.authorizationId,
    receiver: input.receiver,
    ...(input.stagingUrl ? { stagingUrl: input.stagingUrl } : {}),
    ...(input.repo ? { repo: input.repo } : {}),
    ...(input.contractTitle ? { contractTitle: input.contractTitle } : {}),
    mode: input.mode ?? (input.authorizationId.startsWith("SIM-") ? "simulated" : "paypal"),
    issuedAt: now,
    expiresAt,
  };
  return signToken(GRANT_KIND, grant);
}

/** The signed grant, or null if the signature, shape or expiry is wrong. */
export function readGrant(token: unknown): Grant | null {
  const g = verifyToken<Grant>(GRANT_KIND, token);
  if (!g || g.v !== 1) return null;
  const ok =
    typeof g.amount === "number" &&
    Number.isFinite(g.amount) &&
    g.amount > 0 &&
    typeof g.authorizationId === "string" &&
    g.authorizationId.length > 0 &&
    isEmail(g.receiver) &&
    !!g.milestone &&
    typeof g.milestone.id === "string" &&
    Array.isArray(g.milestone.verifiableCriteria);
  return ok ? g : null;
}

/** The grant's milestone as a full Milestone, for code that expects one. */
export function grantMilestone(g: Grant): Milestone {
  return { ...g.milestone, amount: g.amount, status: "funded" };
}
