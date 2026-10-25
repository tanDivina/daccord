import { NextResponse } from "next/server";
import { authorizeOrder, paypalConfigured, PayPalError } from "@/lib/paypal";

// Called from the PayPal Buttons onApprove handler: places the hold on the
// client's funds. PayPal honors an authorization for 3 days and keeps it
// valid for 29, which bounds how long D'accord can wait before capturing.
export async function POST(req: Request) {
  const { orderId, amount, simulate } = await req.json();
  if (typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ success: false, error: "orderId is required" }, { status: 400 });
  }

  if (simulate || orderId.startsWith("SIM-") || !paypalConfigured()) {
    return NextResponse.json({
      success: true,
      mode: "simulated",
      orderId,
      authorizationId: `SIM-AUTH-${Date.now()}`,
      status: "AUTHORIZED",
      amount: Number(amount) || 0,
      expirationTime: new Date(Date.now() + 29 * 86_400_000).toISOString(),
    });
  }

  try {
    const auth = await authorizeOrder(orderId);
    return NextResponse.json({ success: true, mode: "paypal", ...auth });
  } catch (e) {
    const err = e as PayPalError;
    return NextResponse.json(
      { success: false, error: err.message, debugId: err.debugId },
      { status: err.status || 500 }
    );
  }
}
