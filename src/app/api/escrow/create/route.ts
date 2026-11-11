import { NextResponse } from "next/server";
import { createAuthorizeOrder, paypalConfigured, PayPalError } from "@/lib/paypal";
import { grantCommitment, parseGrantInput } from "@/lib/grant";

// Creates a PayPal order with intent AUTHORIZE for one milestone. The client
// approves it in the PayPal popup; nothing is captured until verification.
// The client's terms (criteria, payee, staging URL) are hashed into the
// order's reference_id so the authorize step can only grant those terms.
// reviewWindow ("48h" default, or "demo2m" for sandbox and simulated holds)
// is part of those terms; send the same value to /api/escrow/authorize.
export async function POST(req: Request) {
  const body = await req.json();
  const { amount, contractTitle, simulate } = body;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
    return NextResponse.json({ success: false, error: "Invalid milestone or amount" }, { status: 400 });
  }

  const input = parseGrantInput(body);
  if (!input.ok) {
    return NextResponse.json({ success: false, error: input.error }, { status: 400 });
  }
  const milestoneId = input.value.milestone.id;

  if (simulate || !paypalConfigured()) {
    return NextResponse.json({ success: true, mode: "simulated", orderId: `SIM-ORDER-${Date.now()}` });
  }

  try {
    const order = await createAuthorizeOrder({
      amount: value,
      referenceId: grantCommitment(input.value),
      description: `D'accord milestone ${milestoneId}: ${contractTitle ?? "Contract"}`,
    });
    return NextResponse.json({ success: true, mode: "paypal", orderId: order.id });
  } catch (e) {
    const err = e as PayPalError;
    return NextResponse.json(
      { success: false, error: err.message, debugId: err.debugId },
      { status: err.status || 500 }
    );
  }
}
