import { createHash, createHmac, timingSafeEqual } from "crypto";

// A verification attestation is the only thing that unlocks a payout. The
// verify route signs it after the evaluators agree; the payout route takes the
// amount, receiver and authorization from it, never from the request body.

export interface Attestation {
  milestoneId: string;
  amount: number;
  receiver: string;
  authorizationId: string;
  evidenceHash: string;
  issuedAt: number;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.DACCORD_SIGNING_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DACCORD_SIGNING_SECRET must be set in production");
  }
  return "daccord-local-dev-secret";
}

// Every token kind is signed under its own label, so a token of one kind
// (say a milestone grant) can never be replayed as another (an attestation).
const sign = (kind: string, payload: string) =>
  createHmac("sha256", secret()).update(`daccord:${kind}:${payload}`).digest("base64url");

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signingConfigured(): boolean {
  return Boolean(process.env.DACCORD_SIGNING_SECRET) || process.env.NODE_ENV !== "production";
}

/** Signs any JSON object as `<base64url payload>.<hmac>` under a kind label. */
export function signToken<T extends { expiresAt: number }>(kind: string, data: T): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(kind, payload)}`;
}

/**
 * Returns the signed object, or null when the token is not a string, was signed
 * under another kind or key, is malformed, or has expired.
 */
export function verifyToken<T extends { expiresAt: number }>(kind: string, token: unknown): T | null {
  if (typeof token !== "string" || token.length > 64_000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(kind, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
    if (!data || typeof data !== "object" || typeof data.expiresAt !== "number") return null;
    return data.expiresAt > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function issueAttestation(
  data: Omit<Attestation, "issuedAt" | "expiresAt">
): { token: string; attestation: Attestation } {
  const now = Date.now();
  const attestation: Attestation = { ...data, issuedAt: now, expiresAt: now + TTL_MS };
  return { token: signToken("attestation", attestation), attestation };
}

export function readAttestation(token: unknown): Attestation | null {
  const att = verifyToken<Attestation>("attestation", token);
  if (!att) return null;
  const ok =
    typeof att.milestoneId === "string" &&
    typeof att.amount === "number" &&
    Number.isFinite(att.amount) &&
    att.amount > 0 &&
    typeof att.receiver === "string" &&
    typeof att.authorizationId === "string" &&
    typeof att.evidenceHash === "string";
  return ok ? att : null;
}
