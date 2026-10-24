import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai";
import { paypalConfigured } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    paypal: paypalConfigured() ? (process.env.PAYPAL_ENV === "live" ? "live" : "sandbox") : "simulated",
    paypalClientId: paypalConfigured() ? process.env.PAYPAL_CLIENT_ID : null,
    ai: aiConfigured() ? "claude" : "rules",
    webhooks: Boolean(process.env.PAYPAL_WEBHOOK_ID),
  });
}
