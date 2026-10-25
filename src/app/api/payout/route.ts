import { NextResponse } from "next/server";
import { readAttestation, signingConfigured } from "@/lib/attestation";
import { captureAuthorization, createPayout, getPayout, paypalConfigured, PayPalError } from "@/lib/paypal";

export const maxDuration = 30;

// Releases a verified milestone: captures the client's authorization, then
// pays the contractor through Payouts. Amount, receiver and authorization all
// come from the signed attestation, never from the request body.
export async function POST(req: Request) {
  if (!signingConfigured()) {
    return NextResponse.json({ success: false, error: "Payouts are disabled: DACCORD_SIGNING_SECRET is not set" }, { status: 503 });
  }
  const { attestation: token, contractTitle } = await req.json();
  const att = readAttestation(token);
  if (!att) {
    return NextResponse.json(
      { success: false, error: "Missing, invalid or expired verification attestation" },
      { status: 403 }
    );
  }

  const started = Date.now();
  // The evidence hash makes the batch id unique per verified submission; PayPal
  // rejects a reused sender_batch_id, so a replayed attestation cannot pay twice.
  const senderBatchId = `DACCORD-${att.milestoneId}-${att.evidenceHash.slice(0, 16)}`;

  if (!paypalConfigured() || att.authorizationId.startsWith("SIM-")) {
    return NextResponse.json({
      success: true,
      mode: "simulated",
      receipt: {
        captureId: `SIM-CAP-${Date.now()}`,
        captureStatus: "COMPLETED",
        payoutBatchId: `SIM-${senderBatchId}`,
        batchStatus: "SUCCESS",
        amount: att.amount.toFixed(2),
        receiver: att.receiver,
        senderBatchId,
        elapsedMs: Date.now() - started,
      },
    });
  }

  try {
    const capture = await captureAuthorization(att.authorizationId);
    const payout = await createPayout({
      senderBatchId,
      receiver: att.receiver,
      amount: att.amount,
      subject: "Milestone payment released via D'accord",
      note: `Milestone ${att.milestoneId} of "${String(contractTitle ?? "Contract").slice(0, 80)}" was verified and released.`,
    });
    const batchId = payout.batch_header.payout_batch_id;
    // One status read so the receipt shows PayPal's current state, not the request's.
    const latest = await getPayout(batchId).catch(() => null);

    return NextResponse.json({
      success: true,
      mode: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
      receipt: {
        captureId: capture.id,
        captureStatus: capture.status,
        payoutBatchId: batchId,
        batchStatus: latest?.batch_header?.batch_status ?? payout.batch_header.batch_status,
        transactionId: latest?.items?.[0]?.transaction_id ?? null,
        transactionStatus: latest?.items?.[0]?.transaction_status ?? null,
        fee: latest?.batch_header?.fees?.value ?? null,
        amount: att.amount.toFixed(2),
        receiver: att.receiver,
        senderBatchId,
        elapsedMs: Date.now() - started,
      },
    });
  } catch (e) {
    const err = e as PayPalError;
    console.error("[payout]", err.message, err.details);
    return NextResponse.json(
      { success: false, error: err.message, details: err.details, debugId: err.debugId },
      { status: err.status || 500 }
    );
  }
}
