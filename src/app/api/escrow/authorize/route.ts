import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { authorizeOrder, getOrder, paypalConfigured, PayPalError } from "@/lib/paypal";
import { signingConfigured } from "@/lib/attestation";
import { grantCommitment, GRANT_TTL_MS, issueGrantWithClientKey, parseGrantInput } from "@/lib/grant";
import { storeSetNx } from "@/lib/store";

// Called from the PayPal Buttons onApprove handler: places the hold on the
// client's funds. PayPal honors an authorization for 3 days and keeps it
// valid for 29, which bounds how long D'accord can wait before capturing.
//
// It also returns a signed milestone grant: the client's criteria, the payee
// and the staging URL, bound to this authorization and the amount PayPal
// actually held. The freelancer verifies against the grant and cannot edit it.
//
// It also returns a signed client key bound to this authorization. Only the
// client's browser gets it: approving early or objecting during the review
// window requires it. The grant carries the review window length
// (reviewWindowSec): 48 hours, or 2 minutes when the client picked the demo
// window on a sandbox or simulated hold. Live PayPal holds always get 48 hours.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const { orderId, amount, simulate } = body;
  if (typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ success: false, error: "orderId is required" }, { status: 400 });
  }
  if (!signingConfigured()) {
    return NextResponse.json({ success: false, error: "Holds are disabled: DACCORD_SIGNING_SECRET is not set" }, { status: 503 });
  }

  // Validate the client's terms before touching PayPal, so a bad email never
  // leaves a hold behind without a grant.
  const input = parseGrantInput(body);
  if (!input.ok) {
    return NextResponse.json({ success: false, error: input.error }, { status: 400 });
  }

  if (simulate || orderId.startsWith("SIM-") || !paypalConfigured()) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
      return NextResponse.json({ success: false, error: "Invalid amount" }, { status: 400 });
    }
    const authorizationId = `SIM-AUTH-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const issued = issueGrantWithClientKey({
      ...input.value,
      amount: value,
      authorizationId,
      mode: "simulated",
      expiresAt: Date.now() + GRANT_TTL_MS,
    });
    return NextResponse.json({
      success: true,
      mode: "simulated",
      orderId,
      authorizationId,
      status: "AUTHORIZED",
      amount: value,
      expirationTime: new Date(issued.expiresAt).toISOString(),
      grant: issued.grant,
      clientKey: issued.clientKey,
      reviewWindowSec: issued.reviewWindowSec,
    });
  }

  try {
    // Check the committed terms before placing the hold, so a mismatch never
    // leaves held funds without a grant.
    const commitment = grantCommitment(input.value);
    const order = await getOrder(orderId);
    if (order.referenceId !== commitment) {
      return NextResponse.json(
        { success: false, error: "These terms do not match the PayPal order. Start the hold again." },
        { status: 409 }
      );
    }
    const auth = await authorizeOrder(orderId);
    if (auth.referenceId !== commitment) {
      return NextResponse.json(
        { success: false, error: "These terms do not match the PayPal order. Start the hold again." },
        { status: 409 }
      );
    }
    if (!["CREATED", "PENDING"].includes(auth.status) || !Number.isFinite(auth.amount) || auth.amount <= 0) {
      return NextResponse.json(
        { success: false, error: `PayPal authorization is ${auth.status}, so no grant was issued` },
        { status: 409 }
      );
    }
    const paypalExpiry = auth.expirationTime ? Date.parse(auth.expirationTime) : NaN;
    const issued = issueGrantWithClientKey({
      ...input.value,
      amount: auth.amount,
      authorizationId: auth.authorizationId,
      mode: "paypal",
      expiresAt: Number.isFinite(paypalExpiry) ? paypalExpiry : undefined,
    });
    // PayPal answers a repeated authorize call for the same order with its
    // cached result, and the order id and terms are not secret (the freelancer
    // holds them in the grant). So the client key is issued once per
    // authorization: a second call cannot mint another one.
    let firstIssue: boolean;
    try {
      const ttlSec = Math.max(60, (issued.expiresAt - Date.now()) / 1000) + 86_400;
      firstIssue = await storeSetNx(`daccord:client-key-issued:${auth.authorizationId}`, Date.now(), ttlSec);
    } catch (e) {
      console.error("[authorize] datastore unavailable", e);
      return NextResponse.json(
        { success: false, error: "The datastore is unavailable, so no client key was issued. Try again in a moment." },
        { status: 503 }
      );
    }
    if (!firstIssue) {
      return NextResponse.json(
        { success: false, error: "A client key was already issued for this hold. Only the browser that placed it can approve or object." },
        { status: 409 }
      );
    }
    return NextResponse.json({
      success: true,
      mode: "paypal",
      ...auth,
      grant: issued.grant,
      clientKey: issued.clientKey,
      reviewWindowSec: issued.reviewWindowSec,
    });
  } catch (e) {
    const err = e as PayPalError;
    return NextResponse.json(
      { success: false, error: err.message, debugId: err.debugId },
      { status: err.status || 500 }
    );
  }
}
