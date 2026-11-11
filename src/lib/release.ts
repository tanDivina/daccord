import { randomUUID } from "crypto";
import { z } from "zod";
import { aiConfigured, AiRefusal, askClaude, UNTRUSTED_RULE } from "./ai";
import { readClientKey, sha256 } from "./attestation";
import { grantHash, grantMilestone, grantReviewWindowSec } from "./grant";
import { captureAuthorization, createPayout, getPayout, paypalConfigured } from "./paypal";
import { storeDelIfEquals, storeGet, storeMode, storeSet, storeSetNx, storeZAdd, storeZRangeByScore, storeZRem } from "./store";
import type {
  ArbiterResult,
  Criterion,
  Grant,
  ReleasedBy,
  ReleaseObjection,
  ReleaseReceipt,
  ReleaseRecord,
} from "./types";

// The review window.
//
// A verified milestone no longer pays out at once. Verification opens a review
// window (releaseAt = verifiedAt + the grant's reviewWindowSec). During it the
// client can approve (release now) or object. An objection goes to the scope
// arbiter, judged against the grant's criteria:
//   - IN_SCOPE_DEFECT or MIXED: release paused ("changes_requested") until a
//     new commit passes verification, which opens a fresh window.
//   - OUT_OF_SCOPE_EXPANSION: recorded and shown, the clock keeps running.
//   - After 2 upheld objections, a 3rd upheld one moves the milestone to
//     "escalated": a human arbiter is needed (not built), the funds stay held.
// If the client stays silent, anyone may trigger the release once releaseAt has
// passed (status, claim, or the daily cron sweep). Money only ever goes to the
// grant's payee. Every state change runs under a per-authorization lock in the
// store, so the lazy path and the cron cannot release twice.

export const MAX_UPHELD_OBJECTIONS = 2;
/** Bounds model calls per milestone; out-of-scope objections do not stop the clock. */
export const MAX_OBJECTIONS = 8;
const LOCK_TTL_SEC = 90;
const RECORD_GRACE_SEC = 30 * 86_400;
const DUE_INDEX = "daccord:release-due";
const recordKey = (authorizationId: string) => `daccord:release:${authorizationId}`;
const lockKey = (authorizationId: string) => `daccord:release-lock:${authorizationId}`;

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

let clock: () => number = () => Date.now();
/** Test helper: replace the clock used for windows (signatures still use Date.now). */
export function __setClock(fn: (() => number) | null) {
  clock = fn ?? (() => Date.now());
}

type ReleaseFundsInput = {
  authorizationId: string;
  amount: number;
  receiver: string;
  milestoneId: string;
  contractTitle?: string;
};
export type CaptureMark = { id: string | null; status: string };
export type ReleaseFundsHooks = {
  /** A capture that already happened on an earlier attempt: skip capturing again. */
  captured?: CaptureMark | null;
  /** Called right after the capture succeeds, before the payout. */
  onCaptured?: (capture: CaptureMark) => Promise<void>;
};
type Executor = (input: ReleaseFundsInput, hooks: ReleaseFundsHooks) => Promise<ReleaseReceipt>;
let executorOverride: Executor | null = null;
/** Test helper: replace the PayPal capture + payout. */
export function __setReleaseExecutor(fn: Executor | null) {
  executorOverride = fn;
}

// ---------------------------------------------------------------------------
// Whether the window runs on this deployment
// ---------------------------------------------------------------------------

/**
 * In production on Vercel without a shared datastore, each serverless instance
 * has its own memory, so a review record written by one instance is invisible
 * to the next. The window cannot be trusted there, so the app keeps paying out
 * right after verification. Locally (one `next start` process) memory works.
 */
export function windowEnabled(): boolean {
  return !(process.env.NODE_ENV === "production" && Boolean(process.env.VERCEL) && storeMode() === "memory");
}

export const WINDOW_DISABLED_NOTE =
  "Review window needs a datastore; this deployment pays out right after verification.";

// ---------------------------------------------------------------------------
// Shared release: capture + payout + one status read
// ---------------------------------------------------------------------------

/**
 * One payout per authorization: the batch id comes from the authorization, so
 * PayPal refuses a second payout for the same hold even if two different
 * verifications both reach this point. Capture uses PayPal-Request-Id
 * capture-<authorizationId> and final_capture, so it is idempotent too.
 */
export function senderBatchIdFor(milestoneId: string, authorizationId: string): string {
  const safe = milestoneId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "m";
  return `DACCORD-${safe}-${sha256(`payout:${authorizationId}`).slice(0, 16)}`;
}

/** True when PayPal says this authorization was already captured (by an earlier attempt of ours). */
function alreadyCaptured(e: unknown): boolean {
  const err = e as { status?: number; details?: unknown };
  if (err?.status !== 422) return false;
  try {
    return JSON.stringify(err.details ?? "").includes("AUTHORIZATION_ALREADY_CAPTURED");
  } catch {
    return false;
  }
}

/**
 * Captures the hold and pays the payee. Throws PayPalError on failure.
 *
 * The capture and the payout are two PayPal calls. When the capture succeeds
 * and the payout fails, `onCaptured` has already let the caller record the
 * capture, so a retry passes it back as `captured` and only retries the
 * payout. Only D'accord captures these authorizations, so PayPal's
 * AUTHORIZATION_ALREADY_CAPTURED answer also means "go on to the payout"; the
 * batch id derived from the authorization still stops a second payout.
 */
export async function releaseFunds(input: ReleaseFundsInput, hooks: ReleaseFundsHooks = {}): Promise<ReleaseReceipt> {
  if (executorOverride) return executorOverride(input, hooks);
  const started = Date.now();
  const senderBatchId = senderBatchIdFor(input.milestoneId, input.authorizationId);

  if (!paypalConfigured() || input.authorizationId.startsWith("SIM-")) {
    return {
      mode: "simulated",
      captureId: hooks.captured?.id ?? `SIM-CAP-${Date.now()}`,
      captureStatus: "COMPLETED",
      payoutBatchId: `SIM-${senderBatchId}`,
      batchStatus: "SUCCESS",
      amount: input.amount.toFixed(2),
      receiver: input.receiver,
      senderBatchId,
      elapsedMs: Date.now() - started,
    };
  }

  let capture: CaptureMark;
  if (hooks.captured) {
    capture = hooks.captured;
  } else {
    try {
      const c = await captureAuthorization(input.authorizationId);
      capture = { id: c.id, status: c.status };
    } catch (e) {
      if (!alreadyCaptured(e)) throw e;
      capture = { id: null, status: "ALREADY_CAPTURED" };
    }
    // A failed save must not stop the payout: the batch id still guards against a second one.
    await hooks.onCaptured?.(capture).catch((e) => console.error("[release] could not record the capture", e));
  }
  const payout = await createPayout({
    senderBatchId,
    receiver: input.receiver,
    amount: input.amount,
    subject: "Milestone payment released via D'accord",
    note: `Milestone ${input.milestoneId} of "${String(input.contractTitle ?? "Contract").slice(0, 80)}" was verified and released.`,
  });
  const batchId = payout.batch_header.payout_batch_id;
  // One status read so the receipt shows PayPal's current state, not the request's.
  const latest = await getPayout(batchId).catch(() => null);
  return {
    mode: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
    captureId: capture.id,
    captureStatus: capture.status,
    payoutBatchId: batchId,
    batchStatus: latest?.batch_header?.batch_status ?? payout.batch_header.batch_status,
    transactionId: latest?.items?.[0]?.transaction_id ?? null,
    transactionStatus: latest?.items?.[0]?.transaction_status ?? null,
    fee: latest?.batch_header?.fees?.value ?? null,
    amount: input.amount.toFixed(2),
    receiver: input.receiver,
    senderBatchId,
    elapsedMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Scope arbiter (shared with /api/dispute)
// ---------------------------------------------------------------------------

const ArbiterSchema = z.object({
  classification: z.enum(["IN_SCOPE_DEFECT", "OUT_OF_SCOPE_EXPANSION", "MIXED"]),
  reasoning: z.string(),
  inScopeItems: z.array(z.string()).describe("Parts of the request covered by an agreed criterion, with the criterion id"),
  outOfScopeItems: z.array(z.string()),
  addOnMilestone: z
    .object({
      title: z.string(),
      criteria: z.array(z.string()).describe("Testable acceptance criteria for the new work"),
    })
    .nullable(),
});

const ARBITER_SYSTEM = `You arbitrate revision requests on fixed-scope milestone contracts.
Compare the client's request with the agreed acceptance criteria. Work that an agreed criterion covers is an in-scope defect the contractor must fix.
Work no criterion covers is an out-of-scope expansion: it cannot hold back payment for verified work and belongs in a new paid milestone.
Do not price new work; the parties agree on price.
${UNTRUSTED_RULE}`;

// Fallback when no model is configured: phrase matching, labeled as such.
const EXPANSION_PHRASES = ["also add", "also build", "can you also", "can we also", "new feature", "mobile app", "admin dashboard", "redesign", "additional pages"];

export type ArbiterMilestone = {
  title: string;
  summary: string;
  amount: number;
  verifiableCriteria: Criterion[];
};

/**
 * Classifies a revision request against the agreed criteria. Throws on a model
 * failure (AiRefusal when the model declines). Without a model it falls back
 * to phrase matching and says so (engine "rules").
 */
export async function arbitrateRevision(milestone: ArbiterMilestone, revisionRequest: string): Promise<ArbiterResult> {
  const request = revisionRequest.slice(0, 4000);
  if (!aiConfigured()) {
    const lower = request.toLowerCase();
    const hits = EXPANSION_PHRASES.filter((p) => lower.includes(p));
    return {
      engine: "rules",
      classification: hits.length ? "OUT_OF_SCOPE_EXPANSION" : "IN_SCOPE_DEFECT",
      reasoning: hits.length
        ? `Phrase match (no AI configured): ${hits.join(", ")}.`
        : "No expansion phrases matched (no AI configured), so treated as a defect report.",
      inScopeItems: [],
      outOfScopeItems: [],
      addOnMilestone: null,
    };
  }
  const criteria = milestone.verifiableCriteria
    .map((c) => `- [${c.id}] ${c.description} | target: ${c.targetMetric}`)
    .join("\n");
  const result = await askClaude({
    schema: ArbiterSchema,
    system: ARBITER_SYSTEM,
    effort: "low",
    task: `Milestone: ${milestone.title} ($${milestone.amount})\n${milestone.summary}\n\nAgreed criteria:\n${criteria}\n\nThe client's revision request is below.`,
    untrusted: request,
  });
  return { engine: "claude", ...result };
}

type Arbiter = (milestone: ArbiterMilestone, request: string) => Promise<ArbiterResult>;
let arbiterOverride: Arbiter | null = null;
/** Test helper: replace the arbiter. */
export function __setArbiter(fn: Arbiter | null) {
  arbiterOverride = fn;
}

// ---------------------------------------------------------------------------
// Store access
// ---------------------------------------------------------------------------

export type Outcome =
  | { ok: true; record: ReleaseRecord; arbiter?: ArbiterResult; note?: string }
  | { ok: false; status: number; error: string; record?: ReleaseRecord | null; releaseAt?: number };

const fail = (status: number, error: string, extra: Partial<Extract<Outcome, { ok: false }>> = {}): Outcome => ({
  ok: false,
  status,
  error,
  ...extra,
});

const BUSY = "Another action on this milestone is in progress. Try again in a moment.";

export async function getRecord(authorizationId: string): Promise<ReleaseRecord | null> {
  return storeGet<ReleaseRecord>(recordKey(authorizationId));
}

async function saveRecord(rec: ReleaseRecord): Promise<void> {
  const ttlSec = Math.max(60, (rec.grantExpiresAt - Date.now()) / 1000) + RECORD_GRACE_SEC;
  await storeSet(recordKey(rec.authorizationId), rec, ttlSec);
}

async function withLock(authorizationId: string, fn: () => Promise<Outcome>): Promise<Outcome> {
  const token = randomUUID();
  const key = lockKey(authorizationId);
  if (!(await storeSetNx(key, token, LOCK_TTL_SEC))) return fail(409, BUSY);
  try {
    return await fn();
  } finally {
    await storeDelIfEquals(key, token).catch((e) => console.error("[release] could not drop lock", e));
  }
}

/** Loads the record and checks it belongs to this exact grant. */
async function loadFor(grant: Grant): Promise<{ rec: ReleaseRecord | null; mismatch: boolean }> {
  const rec = await getRecord(grant.authorizationId);
  return { rec, mismatch: Boolean(rec && rec.grantHash !== grantHash(grant)) };
}

const MISMATCH = "This grant does not match the milestone under review for this hold.";

/** Releases a record. The caller must hold the lock and have checked the state. */
async function releaseLocked(rec: ReleaseRecord, by: ReleasedBy): Promise<Outcome> {
  let current = rec;
  try {
    const receipt = await releaseFunds(
      {
        authorizationId: rec.authorizationId,
        amount: rec.payout.amount,
        receiver: rec.payout.receiver,
        milestoneId: rec.payout.milestoneId,
        contractTitle: rec.payout.contractTitle,
      },
      {
        captured: rec.capture ? { id: rec.capture.id, status: rec.capture.status } : null,
        onCaptured: async (c) => {
          current = { ...current, capture: { ...c, at: clock() } };
          await saveRecord(current);
        },
      }
    );
    const released: ReleaseRecord = { ...current, state: "released", releasedBy: by, releasedAt: clock(), receipt, lastError: undefined };
    await saveRecord(released);
    await storeZRem(DUE_INDEX, rec.authorizationId).catch(() => undefined);
    return { ok: true, record: released };
  } catch (e) {
    const err = e as { message?: string; status?: number; debugId?: string };
    const message = `${err.message ?? "Release failed"}${err.debugId ? ` (PayPal debug id ${err.debugId})` : ""}`;
    console.error("[release]", rec.authorizationId, message);
    const failed: ReleaseRecord = {
      ...current,
      lastError: { at: clock(), message: message.slice(0, 500) },
      releaseFailures: (current.releaseFailures ?? 0) + 1,
    };
    await saveRecord(failed).catch(() => undefined);
    return fail(err.status && err.status >= 400 && err.status < 600 ? err.status : 502, message, { record: failed });
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Cheap check before grading, so a commit that cannot open a window does not
 * spend model calls. Returns an error message or null.
 */
export async function reviewBlocker(grant: Grant, headSha: string | null): Promise<string | null> {
  const { rec, mismatch } = await loadFor(grant);
  if (!rec) return null;
  if (mismatch) return MISMATCH;
  if (rec.state === "released") return "This milestone was already paid out.";
  if (rec.state === "escalated") return "This milestone is escalated to a human arbiter, so the funds stay held.";
  if (rec.state === "changes_requested" && headSha && wasReviewed(rec, headSha)) {
    return "The client asked for changes on this commit. Push a new commit to the pull request and verify again.";
  }
  return null;
}

const MAX_REVIEWED_SHAS = 50;

/** True when this commit already passed verification for this milestone (in any window). */
function wasReviewed(rec: ReleaseRecord, headSha: string): boolean {
  return rec.headSha === headSha || Boolean(rec.reviewedShas?.includes(headSha));
}

function withReviewedSha(rec: ReleaseRecord | null, headSha: string | null | undefined): string[] {
  const shas = new Set(rec?.reviewedShas ?? []);
  if (rec?.headSha) shas.add(rec.headSha);
  if (headSha) shas.add(headSha);
  return Array.from(shas).slice(-MAX_REVIEWED_SHAS);
}

/**
 * Called by /api/verify after a passing verification under a grant. Opens the
 * review window, or a fresh one after changes were requested. A passing
 * verification while a window is already open keeps that window (the clock
 * does not restart).
 */
export async function openReview(
  grant: Grant,
  opts: { evidenceHash: string; headSha?: string | null }
): Promise<Outcome> {
  return withLock(grant.authorizationId, async () => {
    const { rec, mismatch } = await loadFor(grant);
    if (mismatch) return fail(403, MISMATCH);
    if (rec?.state === "released") return fail(409, "This milestone was already paid out.", { record: rec });
    if (rec?.state === "escalated") {
      return fail(409, "This milestone is escalated to a human arbiter, so the funds stay held.", { record: rec });
    }
    if (rec?.state === "review") {
      // The clock does not restart, but the record follows the latest passing
      // commit, so an objection covers it and that commit cannot reopen a window.
      if (opts.headSha && opts.headSha !== rec.headSha) {
        const updated: ReleaseRecord = {
          ...rec,
          headSha: opts.headSha,
          attestationEvidenceHash: opts.evidenceHash,
          reviewedShas: withReviewedSha(rec, opts.headSha),
        };
        await saveRecord(updated);
        return { ok: true, record: updated, note: "A review window is already open for this hold; it now covers this commit." };
      }
      return { ok: true, record: rec, note: "A review window is already open for this hold." };
    }
    if (rec?.state === "changes_requested" && opts.headSha && wasReviewed(rec, opts.headSha)) {
      return fail(409, "The client asked for changes on this commit. Push a new commit and verify again.", { record: rec });
    }

    const now = clock();
    const reviewWindowSec = grantReviewWindowSec(grant);
    const next: ReleaseRecord = {
      v: 1,
      authorizationId: grant.authorizationId,
      state: "review",
      grantHash: grantHash(grant),
      verifiedAt: now,
      releaseAt: now + reviewWindowSec * 1000,
      reviewWindowSec,
      attestationEvidenceHash: opts.evidenceHash,
      ...(opts.headSha ? { headSha: opts.headSha } : {}),
      reviewedShas: withReviewedSha(rec, opts.headSha),
      objections: rec?.objections ?? [],
      upheldObjections: rec?.upheldObjections ?? 0,
      reviews: (rec?.reviews ?? 0) + 1,
      payout: {
        milestoneId: grant.milestone.id,
        amount: grant.amount,
        receiver: grant.receiver,
        mode: grant.mode,
        ...(grant.contractTitle ? { contractTitle: grant.contractTitle } : {}),
      },
      grantExpiresAt: grant.expiresAt,
    };
    await saveRecord(next);
    await storeZAdd(DUE_INDEX, grant.authorizationId, next.releaseAt);
    return { ok: true, record: next };
  });
}

const isDue = (rec: ReleaseRecord, now: number) => rec.state === "review" && now >= rec.releaseAt;

/**
 * Releases the record if its window has passed. Returns the outcome, or null
 * when nothing was due. Used by status, claim, object and the cron sweep.
 */
async function releaseIfDue(authorizationId: string, by: ReleasedBy, grant: Grant | null): Promise<Outcome | null> {
  const peek = await getRecord(authorizationId);
  if (!peek || !isDue(peek, clock())) return null;
  return withLock(authorizationId, async () => {
    const rec = await getRecord(authorizationId);
    if (!rec) return fail(404, "No verified submission is under review for this hold.");
    if (grant && rec.grantHash !== grantHash(grant)) return fail(403, MISMATCH);
    if (rec.state === "released") return { ok: true, record: rec };
    if (!isDue(rec, clock())) return fail(409, "Not due.", { record: rec, releaseAt: rec.releaseAt });
    return releaseLocked(rec, by);
  });
}

/** POST /api/release/status: releases a due record first, then returns it. */
export async function releaseStatus(grant: Grant): Promise<Outcome | { ok: true; record: null }> {
  const { rec, mismatch } = await loadFor(grant);
  if (mismatch) return fail(403, MISMATCH);
  if (!rec) return { ok: true, record: null };
  if (isDue(rec, clock())) {
    const out = await releaseIfDue(grant.authorizationId, "auto", grant);
    // A failed or busy release still reports the record (with lastError) to the caller.
    if (out && !out.ok) {
      const latest = await getRecord(grant.authorizationId);
      return latest ? { ok: true, record: latest } : out;
    }
    if (out) return out;
  }
  return { ok: true, record: rec };
}

/** POST /api/release/claim: anyone may trigger a due release; money only goes to the payee. */
export async function claimRelease(grant: Grant): Promise<Outcome> {
  const { rec, mismatch } = await loadFor(grant);
  if (mismatch) return fail(403, MISMATCH);
  if (!rec) return fail(404, "No verified submission is under review for this hold.");
  if (rec.state === "released") return { ok: true, record: rec };
  if (rec.state !== "review") {
    return fail(409, rec.state === "escalated"
      ? "This milestone is escalated to a human arbiter, so the funds stay held."
      : "The client asked for in-scope changes. Push a new commit and verify again.", { record: rec });
  }
  if (clock() < rec.releaseAt) {
    return fail(409, "The client's review window is still open.", { record: rec, releaseAt: rec.releaseAt });
  }
  const out = await releaseIfDue(grant.authorizationId, "freelancer_claim", grant);
  return out ?? fail(409, "Not due.", { record: rec, releaseAt: rec.releaseAt });
}

/** POST /api/release/approve: the client releases now. */
export async function approveRelease(grant: Grant, clientKey: unknown): Promise<Outcome> {
  if (!readClientKey(clientKey, grant.authorizationId)) {
    return fail(403, "Only the client can approve: the client key is missing, invalid or for another hold.");
  }
  return withLock(grant.authorizationId, async () => {
    const { rec, mismatch } = await loadFor(grant);
    if (mismatch) return fail(403, MISMATCH);
    if (!rec) return fail(404, "No verified submission is under review for this hold.");
    if (rec.state === "released") return { ok: true, record: rec };
    if (rec.state !== "review") {
      return fail(409, `Nothing to approve: the milestone is ${rec.state.replace("_", " ")}.`, { record: rec });
    }
    // Approving after the window closed is still the client's approval.
    return releaseLocked(rec, "client_approval");
  });
}

/** POST /api/release/object: the client objects with written reasons. */
export async function objectToRelease(grant: Grant, clientKey: unknown, reasons: unknown): Promise<Outcome> {
  if (!readClientKey(clientKey, grant.authorizationId)) {
    return fail(403, "Only the client can object: the client key is missing, invalid or for another hold.");
  }
  const text = typeof reasons === "string" ? reasons.trim().slice(0, 4000) : "";
  if (!text) return fail(400, "Write the reasons for the objection.");
  const receivedAt = clock();

  // A window that already closed releases first; the objection is then too late.
  const due = await releaseIfDue(grant.authorizationId, "auto", grant);
  if (due) {
    return due.ok
      ? fail(409, "The review window had closed, so the funds were released.", { record: due.record })
      : due;
  }

  // Check before spending a model call. The same checks run again under the
  // lock after the arbiter answers, because the record may change meanwhile.
  const pre = await loadFor(grant);
  const preBlock = objectionBlocker(pre.rec, pre.mismatch, receivedAt);
  if (preBlock) return preBlock;
  const seen = { verifiedAt: pre.rec!.verifiedAt, reviews: pre.rec!.reviews };

  // The arbiter runs outside the release lock, so a slow model call never
  // outlives the lock and never holds up a due release. A separate short
  // marker keeps one objection in flight per hold, which bounds model calls.
  const flightKey = objectingKey(grant.authorizationId);
  const flightToken = randomUUID();
  if (!(await storeSetNx(flightKey, flightToken, OBJECTING_TTL_SEC))) return fail(409, BUSY, { record: pre.rec });
  let arbiter: ArbiterResult;
  try {
    const m = grantMilestone(grant);
    arbiter = await withTimeout(
      (arbiterOverride ?? arbitrateRevision)(
        { title: m.title, summary: m.summary, amount: m.amount, verifiableCriteria: m.verifiableCriteria },
        text
      ),
      ARBITER_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[release] arbiter failed", e);
    await storeDelIfEquals(flightKey, flightToken).catch(() => undefined);
    const msg = e instanceof AiRefusal ? `Model declined: ${e.message}` : "Scope arbiter failed. Try again.";
    return fail(502, msg, { record: (await getRecord(grant.authorizationId).catch(() => null)) ?? pre.rec });
  }

  try {
    return await withLock(grant.authorizationId, async () => {
      const { rec, mismatch } = await loadFor(grant);
      const block = objectionBlocker(rec, mismatch, receivedAt);
      if (block) return block;
      if (!rec) return fail(404, "No verified submission is under review for this hold.");
      if (rec.verifiedAt !== seen.verifiedAt || rec.reviews !== seen.reviews) {
        return fail(409, "A new review window opened while the arbiter was deciding. Object again if it still applies.", { record: rec });
      }
      return applyObjection(rec, receivedAt, text, arbiter);
    });
  } finally {
    await storeDelIfEquals(flightKey, flightToken).catch(() => undefined);
  }
}

const OBJECTING_TTL_SEC = 120;
const ARBITER_TIMEOUT_MS = 50_000;
const objectingKey = (authorizationId: string) => `daccord:release-objecting:${authorizationId}`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Scope arbiter timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Why an objection cannot be accepted now, or null when it can. */
function objectionBlocker(rec: ReleaseRecord | null, mismatch: boolean, receivedAt: number): Outcome | null {
  if (mismatch) return fail(403, MISMATCH);
  if (!rec) return fail(404, "No verified submission is under review for this hold.");
  if (rec.state === "released") return fail(409, "The funds were already released, so objections are closed.", { record: rec });
  if (rec.state === "escalated") return fail(409, "This milestone is already escalated to a human arbiter.", { record: rec });
  if (rec.state === "changes_requested") {
    return fail(409, "Changes are already requested. Wait for the contractor's next verified commit.", { record: rec });
  }
  if (rec.capture) {
    return fail(409, "The client's payment was already captured for release, so objections are closed.", { record: rec });
  }
  if (receivedAt >= rec.releaseAt) {
    return fail(409, "The review window has closed.", { record: rec, releaseAt: rec.releaseAt });
  }
  if (rec.objections.length >= MAX_OBJECTIONS) {
    return fail(429, `At most ${MAX_OBJECTIONS} objections per milestone.`, { record: rec });
  }
  return null;
}

/** Records the arbiter's verdict. The caller holds the lock and has re-checked the record. */
async function applyObjection(rec: ReleaseRecord, receivedAt: number, text: string, arbiter: ArbiterResult): Promise<Outcome> {
  const upheld = arbiter.classification !== "OUT_OF_SCOPE_EXPANSION";
  const objection: ReleaseObjection = { at: receivedAt, text, upheld, ...arbiter };
  const next: ReleaseRecord = { ...rec, objections: [...rec.objections, objection] };
  if (upheld) {
    if (rec.upheldObjections >= MAX_UPHELD_OBJECTIONS) {
      next.state = "escalated";
    } else {
      next.state = "changes_requested";
      next.upheldObjections = rec.upheldObjections + 1;
    }
  }
  await saveRecord(next);
  if (next.state !== "review") await storeZRem(DUE_INDEX, rec.authorizationId);
  return { ok: true, record: next, arbiter };
}

/** GET /api/cron/release: releases every record whose window has passed. */
export async function sweepDue(limit = 25): Promise<{ released: number; checked: number; failed: number }> {
  const now = clock();
  const ids = await storeZRangeByScore(DUE_INDEX, now, limit);
  let released = 0;
  let failed = 0;
  for (const id of ids) {
    const rec = await getRecord(id);
    if (!rec || rec.state !== "review") {
      await storeZRem(DUE_INDEX, id).catch(() => undefined);
      continue;
    }
    const out = await releaseIfDue(id, "cron", null);
    if (out?.ok && out.record.releasedBy === "cron") released++;
    else if (out && !out.ok) {
      failed++;
      // A release that keeps failing must not starve newer due records: push
      // it past the next daily sweep, and stop sweeping it after a few tries.
      // The status check and the claim button still retry it at any time.
      const failures = (await getRecord(id).catch(() => null))?.releaseFailures ?? 1;
      if (out.status === 409 && out.error === BUSY) continue;
      if (failures >= CRON_MAX_FAILURES) await storeZRem(DUE_INDEX, id).catch(() => undefined);
      else await storeZAdd(DUE_INDEX, id, now + failures * CRON_BACKOFF_MS).catch(() => undefined);
    }
  }
  return { released, checked: ids.length, failed };
}

const CRON_MAX_FAILURES = 5;
const CRON_BACKOFF_MS = 25 * 3600_000;
