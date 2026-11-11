import { issueClientKey, sha256, signToken, verifyToken } from "./attestation";
import type { Criterion, Grant, GrantMilestone, Milestone, ReviewWindowChoice, VerificationType } from "./types";

// A milestone grant binds the client's terms (criteria, probe URLs, payee,
// staging URL) to one PayPal authorization. The client sets them before the
// hold; the freelancer only ever sees the signed result and cannot change it.

const GRANT_KIND = "grant";
/** PayPal keeps an authorization valid for 29 days, so a grant never outlives it. */
export const GRANT_TTL_MS = 29 * 86_400_000;

/** The client's review window after verification: 48 hours. */
export const REVIEW_WINDOW_48H_SEC = 48 * 60 * 60;
/** Demo window for sandbox and simulated holds only, so a viewer can watch an auto-release. */
export const REVIEW_WINDOW_DEMO_SEC = 120;

/**
 * Window length for a hold. Live PayPal holds always get 48 hours; the demo
 * window is honored only for sandbox and simulated holds.
 */
export function reviewWindowSecFor(choice: ReviewWindowChoice | undefined, mode: Grant["mode"]): number {
  const live = mode === "paypal" && process.env.PAYPAL_ENV === "live";
  return choice === "demo2m" && !live ? REVIEW_WINDOW_DEMO_SEC : REVIEW_WINDOW_48H_SEC;
}

/** The grant's window, defaulting to 48 hours for grants signed before the window existed. */
export function grantReviewWindowSec(g: Grant): number {
  return typeof g.reviewWindowSec === "number" && g.reviewWindowSec > 0 ? g.reviewWindowSec : REVIEW_WINDOW_48H_SEC;
}

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
  /** Review window the client chose; "48h" when not given. */
  reviewWindow?: ReviewWindowChoice;
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
  reviewWindow?: unknown;
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

  let reviewWindow: ReviewWindowChoice = "48h";
  if (body.reviewWindow !== undefined && body.reviewWindow !== null && body.reviewWindow !== "") {
    if (body.reviewWindow !== "48h" && body.reviewWindow !== "demo2m") {
      return { ok: false, error: "reviewWindow must be \"48h\" or \"demo2m\"" };
    }
    reviewWindow = body.reviewWindow;
  }

  const contractTitle = str(body.contractTitle, 200) ?? undefined;
  return {
    ok: true,
    value: { milestone: { id, title, summary, verifiableCriteria: criteria }, receiver, stagingUrl, repo, contractTitle, reviewWindow },
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
    // Only added for the demo window, so 48h terms hash as they did before.
    ...(input.reviewWindow === "demo2m" ? { reviewWindow: "demo2m" } : {}),
  });
  return `dk1-${sha256(canonical)}`;
}

export function issueGrant(input: IssueGrantInput): string {
  return issueGrantWithClientKey(input).grant;
}

/**
 * Signs the grant and a client key bound to the same authorization and expiry.
 * The client key goes only to the client's browser: it approves or objects
 * during the review window.
 */
export function issueGrantWithClientKey(input: IssueGrantInput): {
  grant: string;
  clientKey: string;
  reviewWindowSec: number;
  expiresAt: number;
} {
  const now = Date.now();
  const cap = now + GRANT_TTL_MS;
  const expiresAt =
    input.expiresAt && Number.isFinite(input.expiresAt) && input.expiresAt > now ? Math.min(input.expiresAt, cap) : cap;
  const mode = input.mode ?? (input.authorizationId.startsWith("SIM-") ? "simulated" : "paypal");
  const reviewWindowSec = reviewWindowSecFor(input.reviewWindow, mode);
  const grant: Grant = {
    v: 1,
    milestone: input.milestone,
    amount: input.amount,
    authorizationId: input.authorizationId,
    receiver: input.receiver,
    ...(input.stagingUrl ? { stagingUrl: input.stagingUrl } : {}),
    ...(input.repo ? { repo: input.repo } : {}),
    ...(input.contractTitle ? { contractTitle: input.contractTitle } : {}),
    mode,
    reviewWindowSec,
    issuedAt: now,
    expiresAt,
  };
  return {
    grant: signToken(GRANT_KIND, grant),
    clientKey: issueClientKey(input.authorizationId, expiresAt),
    reviewWindowSec,
    expiresAt,
  };
}

/** Identifies one signed grant (the review record stores it to refuse other grants). */
export function grantHash(g: Grant): string {
  return sha256(`grant:${JSON.stringify(g)}`);
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
    Array.isArray(g.milestone.verifiableCriteria) &&
    (g.reviewWindowSec === undefined ||
      (typeof g.reviewWindowSec === "number" && Number.isFinite(g.reviewWindowSec) && g.reviewWindowSec > 0));
  return ok ? g : null;
}

/** The grant's milestone as a full Milestone, for code that expects one. */
export function grantMilestone(g: Grant): Milestone {
  return { ...g.milestone, amount: g.amount, status: "funded" };
}
