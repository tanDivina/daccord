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

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function issueAttestation(
  data: Omit<Attestation, "issuedAt" | "expiresAt">
): { token: string; attestation: Attestation } {
  const now = Date.now();
  const attestation: Attestation = { ...data, issuedAt: now, expiresAt: now + TTL_MS };
  const payload = Buffer.from(JSON.stringify(attestation)).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, attestation };
}

export function signingConfigured(): boolean {
  return Boolean(process.env.DACCORD_SIGNING_SECRET) || process.env.NODE_ENV !== "production";
}

export function readAttestation(token: unknown): Attestation | null {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const attestation = JSON.parse(Buffer.from(payload, "base64url").toString()) as Attestation;
    return attestation.expiresAt > Date.now() ? attestation : null;
  } catch {
    return null;
  }
}
