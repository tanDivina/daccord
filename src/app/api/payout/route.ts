import { NextResponse } from "next/server";
import { readAttestation, signingConfigured } from "@/lib/attestation";
import type { PayPalError } from "@/lib/paypal";
import { releaseFunds, WINDOW_DISABLED_NOTE, windowEnabled } from "@/lib/release";

export const maxDuration = 30;

// Fallback path only. With the review window on, a passing verification opens
// a window instead of signing an attestation, and funds move through
// /api/release/*. This route is used only on a deployment that cannot run the
// window (production without a datastore), where it pays right after
// verification as before.
//
// Amount, receiver and authorization all come from the signed attestation,
// never from the request body. /api/verify signs an attestation only for a
// valid milestone grant, and copies those fields straight from the grant.
// contractTitle from the body is used only as text in the payout note.
export async function POST(req: Request) {
  if (!signingConfigured()) {
    return NextResponse.json({ success: false, error: "Payouts are disabled: DACCORD_SIGNING_SECRET is not set" }, { status: 503 });
  }
  if (windowEnabled()) {
    return NextResponse.json(
      { success: false, error: "This deployment uses the client's review window. Payment releases through /api/release." },
      { status: 409 }
    );
  }
  const { attestation: token, contractTitle } = ((await req.json().catch(() => ({}))) ?? {}) as {
    attestation?: unknown;
    contractTitle?: unknown;
  };
  const att = readAttestation(token);
  if (!att) {
    return NextResponse.json(
      { success: false, error: "Missing, invalid or expired verification attestation" },
      { status: 403 }
    );
  }

  try {
    // One payout per authorization: the batch id is derived from the
    // authorization, so PayPal rejects a second payout for the same hold.
    const { mode, ...receipt } = await releaseFunds({
      authorizationId: att.authorizationId,
      amount: att.amount,
      receiver: att.receiver,
      milestoneId: att.milestoneId,
      contractTitle: typeof contractTitle === "string" ? contractTitle : undefined,
    });
    return NextResponse.json({ success: true, mode, receipt, note: WINDOW_DISABLED_NOTE });
  } catch (e) {
    const err = e as PayPalError;
    console.error("[payout]", err.message, err.details);
    return NextResponse.json(
      { success: false, error: err.message, details: err.details, debugId: err.debugId },
      { status: err.status || 500 }
    );
  }
}
