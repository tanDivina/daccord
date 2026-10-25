import { NextResponse } from "next/server";
import { createAuthorizeOrder, paypalConfigured, PayPalError } from "@/lib/paypal";

// Creates a PayPal order with intent AUTHORIZE for one milestone. The client
// approves it in the PayPal popup; nothing is captured until verification.
export async function POST(req: Request) {
  const { milestoneId, amount, contractTitle, simulate } = await req.json();
  const value = Number(amount);
  if (!milestoneId || !Number.isFinite(value) || value <= 0 || value > 10_000) {
    return NextResponse.json({ success: false, error: "Invalid milestone or amount" }, { status: 400 });
  }

  if (simulate || !paypalConfigured()) {
    return NextResponse.json({ success: true, mode: "simulated", orderId: `SIM-ORDER-${Date.now()}` });
  }

  try {
    const order = await createAuthorizeOrder({
      amount: value,
      referenceId: String(milestoneId).slice(0, 256),
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
