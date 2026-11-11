import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sweepDue, windowEnabled } from "@/lib/release";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily Vercel cron (vercel.json). Releases every review whose window passed
// without a client response. Vercel sends "Authorization: Bearer $CRON_SECRET"
// when CRON_SECRET is set. Without CRON_SECRET this route refuses in production.
// The lazy path (status and claim) releases due reviews in between sweeps.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!windowEnabled()) return NextResponse.json({ released: 0, checked: 0, windowEnabled: false });
  try {
    const { released, checked, failed } = await sweepDue();
    return NextResponse.json({ released, checked, failed });
  } catch (e) {
    console.error("[cron/release]", e);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
