import { NextResponse } from "next/server";
import { paypalConfigured, verifyWebhookSignature } from "@/lib/paypal";

// PayPal webhook receiver. Signatures are checked with PayPal's
// verify-webhook-signature API before any event is trusted.
export async function POST(req: Request) {
  if (!paypalConfigured() || !process.env.PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "Webhooks not configured" }, { status: 503 });
  }

  const event = await req.json();
  let valid = false;
  try {
    valid = await verifyWebhookSignature(req.headers, event);
  } catch (e) {
    console.error("[webhook] verification call failed", e);
    return NextResponse.json({ error: "Verification unavailable" }, { status: 502 });
  }
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  // No database yet, so events are logged for reconciliation.
  console.log("[webhook]", event.event_type, event.resource?.id, event.resource?.status);
  return NextResponse.json({ received: true });
}
