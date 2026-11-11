/**
 * Small JSON key-value store shared by the retry limits (attempts.ts) and the
 * review window (release.ts).
 *
 * Storage: Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set, or KV_REST_API_URL and KV_REST_API_TOKEN
 * (the names the Vercel marketplace integration uses). Plain fetch, no extra
 * dependency. Otherwise an in-memory Map.
 *
 * The high-level helpers throw when Upstash is configured but unreachable.
 * They never fall back to memory on their own: for the review window a silent
 * switch to per-instance memory could release the same milestone twice.
 * Callers that can live with a per-instance fallback (the retry limits) use
 * `memory` directly in their catch block.
 *
 * NOTE: on serverless hosts (Vercel) each function instance has its own memory
 * and instances are recycled at any time, so memory mode is per-instance and
 * best effort only.
 */

export type StoreMode = "upstash" | "memory";

function upstashCreds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { url, token };
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };
  return null;
}

export function storeMode(): StoreMode {
  return upstashCreds() ? "upstash" : "memory";
}

// ---------------------------------------------------------------------------
// Upstash REST
// ---------------------------------------------------------------------------

type UpstashResult = { result?: unknown; error?: string };

/** Runs Redis commands in one Upstash REST pipeline call. Throws on any error. */
export async function upstashPipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const creds = upstashCreds();
  if (!creds) throw new Error("Upstash is not configured");
  const res = await fetch(`${creds.url.replace(/\/+$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const out = (await res.json()) as UpstashResult[];
  return out.map((r) => {
    if (r.error) throw new Error(`Upstash: ${r.error}`);
    return r.result;
  });
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const MEM_MAX_KEYS = 5000;
const memValues = new Map<string, { value: string; expiresAt: number | null }>();
const memSets = new Map<string, Map<string, number>>();

function memLive(key: string): string | null {
  const hit = memValues.get(key);
  if (!hit) return null;
  if (hit.expiresAt !== null && hit.expiresAt <= Date.now()) {
    memValues.delete(key);
    return null;
  }
  return hit.value;
}

function memPut(key: string, value: string, ttlSec?: number) {
  memValues.delete(key);
  memValues.set(key, { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null });
  // Maps iterate in insertion order, so the first keys are the oldest.
  while (memValues.size > MEM_MAX_KEYS) {
    const oldest = memValues.keys().next().value;
    if (oldest === undefined) break;
    memValues.delete(oldest);
  }
}

/** Direct access to the in-memory store, for callers that fall back to it on purpose. */
export const memory = {
  get<T>(key: string): T | null {
    const raw = memLive(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  },
  set(key: string, value: unknown, ttlSec?: number) {
    memPut(key, JSON.stringify(value), ttlSec);
  },
  del(key: string) {
    memValues.delete(key);
  },
  setnx(key: string, value: unknown, ttlSec: number): boolean {
    if (memLive(key) !== null) return false;
    memPut(key, JSON.stringify(value), ttlSec);
    return true;
  },
  delIfEquals(key: string, value: unknown): boolean {
    if (memLive(key) !== JSON.stringify(value)) return false;
    memValues.delete(key);
    return true;
  },
  zadd(key: string, member: string, score: number) {
    let set = memSets.get(key);
    if (!set) memSets.set(key, (set = new Map()));
    set.set(member, score);
  },
  zrem(key: string, member: string) {
    memSets.get(key)?.delete(member);
  },
  zrangeByScore(key: string, max: number, limit: number): string[] {
    const set = memSets.get(key);
    if (!set) return [];
    return Array.from(set.entries())
      .filter(([, s]) => s <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([m]) => m);
  },
  /** Test helper: forget everything. */
  reset() {
    memValues.clear();
    memSets.clear();
  },
};

// ---------------------------------------------------------------------------
// Public helpers (JSON values)
// ---------------------------------------------------------------------------

export async function storeGet<T>(key: string): Promise<T | null> {
  if (storeMode() === "memory") return memory.get<T>(key);
  const [raw] = await upstashPipeline([["GET", key]]);
  return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
}

export async function storeSet(key: string, value: unknown, ttlSec?: number): Promise<void> {
  if (storeMode() === "memory") return memory.set(key, value, ttlSec);
  const ttl = ttlSec ? Math.max(1, Math.ceil(ttlSec)) : 0;
  await upstashPipeline([ttl ? ["SET", key, JSON.stringify(value), "EX", ttl] : ["SET", key, JSON.stringify(value)]]);
}

export async function storeDel(key: string): Promise<void> {
  if (storeMode() === "memory") return memory.del(key);
  await upstashPipeline([["DEL", key]]);
}

/** Sets the key only if it does not exist. Returns true when this call set it. */
export async function storeSetNx(key: string, value: unknown, ttlSec: number): Promise<boolean> {
  if (storeMode() === "memory") return memory.setnx(key, value, ttlSec);
  const ttl = Math.max(1, Math.ceil(ttlSec));
  const [res] = await upstashPipeline([["SET", key, JSON.stringify(value), "NX", "EX", ttl]]);
  return res === "OK";
}

const DEL_IF_EQUALS = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Deletes the key only if it still holds this value (used to release a lock we own). */
export async function storeDelIfEquals(key: string, value: unknown): Promise<boolean> {
  if (storeMode() === "memory") return memory.delIfEquals(key, value);
  const [res] = await upstashPipeline([["EVAL", DEL_IF_EQUALS, 1, key, JSON.stringify(value)]]);
  return Number(res) === 1;
}

/** Sorted-set index helpers (used for the list of reviews that come due). */
export async function storeZAdd(key: string, member: string, score: number): Promise<void> {
  if (storeMode() === "memory") return memory.zadd(key, member, score);
  await upstashPipeline([["ZADD", key, score, member]]);
}

export async function storeZRem(key: string, member: string): Promise<void> {
  if (storeMode() === "memory") return memory.zrem(key, member);
  await upstashPipeline([["ZREM", key, member]]);
}

export async function storeZRangeByScore(key: string, max: number, limit: number): Promise<string[]> {
  if (storeMode() === "memory") return memory.zrangeByScore(key, max, limit);
  const [res] = await upstashPipeline([["ZRANGEBYSCORE", key, "-inf", max, "LIMIT", 0, limit]]);
  return Array.isArray(res) ? res.map(String) : [];
}
