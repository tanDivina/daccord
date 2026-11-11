import { createHash, randomUUID } from "crypto";
import { memory, storeGet, storeMode, storeSet, upstashPipeline, type StoreMode } from "./store";

/**
 * Verification attempt limits and sticky failures.
 *
 * - checkAttempt: at most ATTEMPT_LIMIT verification attempts per key in a rolling
 *   ATTEMPT_WINDOW_SEC window, so a borderline submission cannot be rerolled until
 *   both model passes happen to agree.
 * - getVerdict / rememberVerdict: a failed verdict is remembered per evidence hash,
 *   so resubmitting identical evidence returns the earlier failure instead of asking
 *   the model again. Passes are never cached.
 *
 * Storage: store.ts (Upstash Redis over REST when its variables are set, otherwise
 * an in-memory Map). If Upstash is set but unreachable, these limits fall back to
 * per-instance memory. Keys are stored as SHA-256 hashes, never as raw authorization ids.
 */

export const ATTEMPT_LIMIT = 5;
export const ATTEMPT_WINDOW_SEC = 60 * 60;
/** Graded attempts per grant over its whole life (PayPal keeps a hold for 29 days). */
export const GRANT_LIFETIME_LIMIT = 15;
export const GRANT_LIFETIME_SEC = 29 * 24 * 60 * 60;
/** All Threat lab (grading-only) model calls on this deployment, per hour. */
export const LAB_GLOBAL_LIMIT = 60;
const VERDICT_TTL_SEC = 7 * 24 * 60 * 60;
const PREFIX = "daccord";

export type AttemptCheck = { allowed: boolean; count: number; limit: number; retryAfterSec: number };
export type StoredVerdict = { verified: boolean; summary: string; at: string };

/** Kept for existing callers; same as storeMode() in store.ts. */
export function storageMode(): StoreMode {
  return storeMode();
}

function hashKey(kind: string, key: string): string {
  return `${PREFIX}:${kind}:${createHash("sha256").update(key).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// In-memory fallback
//
// NOTE: on serverless hosts (Vercel) each function instance has its own memory and
// instances are recycled at any time, so these limits are per-instance and best
// effort only. Set the Upstash variables for a limit that holds across instances.
// ---------------------------------------------------------------------------

const memAttempts = new Map<string, number[]>();
const MEM_MAX_KEYS = 5000;

function memPrune<V>(map: Map<string, V>) {
  // Maps iterate in insertion order, so the first keys are the oldest.
  while (map.size > MEM_MAX_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function memCheckAttempt(k: string, now: number, limit: number, windowMs: number): AttemptCheck {
  const recent = (memAttempts.get(k) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    memAttempts.set(k, recent);
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    return { allowed: false, count: recent.length, limit, retryAfterSec };
  }
  recent.push(now);
  memAttempts.delete(k);
  memAttempts.set(k, recent);
  memPrune(memAttempts);
  return { allowed: true, count: recent.length, limit, retryAfterSec: 0 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Records one verification attempt for `key` and says whether it may proceed.
 * `count` includes this attempt when allowed. Denied attempts are not recorded,
 * so hammering the endpoint does not extend the lockout.
 */
export async function checkAttempt(
  key: string,
  opts: { limit?: number; windowSec?: number } = {}
): Promise<AttemptCheck> {
  const limit = opts.limit ?? ATTEMPT_LIMIT;
  const windowMs = (opts.windowSec ?? ATTEMPT_WINDOW_SEC) * 1000;
  const now = Date.now();
  const k = hashKey("attempts", key);

  if (storageMode() === "upstash") {
    const member = `${now}-${randomUUID()}`;
    try {
      // Add first, then count, so concurrent requests cannot all slip under the limit.
      const [, , card, oldest] = await upstashPipeline([
        ["ZREMRANGEBYSCORE", k, 0, now - windowMs],
        ["ZADD", k, now, member],
        ["ZCARD", k],
        ["ZRANGE", k, 0, 0, "WITHSCORES"],
        ["PEXPIRE", k, windowMs],
      ]);
      const count = Number(card);
      if (count > limit) {
        await upstashPipeline([["ZREM", k, member]]);
        const oldestScore = Array.isArray(oldest) && oldest.length >= 2 ? Number(oldest[1]) : now;
        const retryAfterSec = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));
        return { allowed: false, count: count - 1, limit, retryAfterSec };
      }
      return { allowed: true, count, limit, retryAfterSec: 0 };
    } catch (e) {
      console.error("[attempts] Upstash unavailable, using in-memory limit", e);
    }
  }
  return memCheckAttempt(k, now, limit, windowMs);
}

/** Returns a remembered failed verdict for this evidence hash, or null. */
export async function getVerdict(evidenceHash: string): Promise<StoredVerdict | null> {
  const k = hashKey("verdict", evidenceHash);
  let parsed: StoredVerdict | null;
  try {
    parsed = await storeGet<StoredVerdict>(k);
  } catch (e) {
    console.error("[attempts] Upstash unavailable, reading in-memory verdicts", e);
    parsed = memory.get<StoredVerdict>(k);
  }
  return parsed && parsed.verified === false ? parsed : null;
}

/**
 * Remembers a verdict for this evidence hash. Only failures are stored: a pass is
 * never cached, so it cannot be replayed as a free pass later.
 */
export async function rememberVerdict(
  evidenceHash: string,
  verdict: { verified: boolean; summary: string }
): Promise<void> {
  if (verdict.verified) return;
  const k = hashKey("verdict", evidenceHash);
  const stored: StoredVerdict = { verified: false, summary: verdict.summary.slice(0, 2000), at: new Date().toISOString() };
  try {
    await storeSet(k, stored, VERDICT_TTL_SEC);
  } catch (e) {
    console.error("[attempts] Upstash unavailable, storing verdict in memory", e);
    memory.set(k, stored, VERDICT_TTL_SEC);
  }
}
