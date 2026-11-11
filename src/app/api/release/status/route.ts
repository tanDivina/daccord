import { NextResponse } from "next/server";
import { releaseStatus, windowEnabled } from "@/lib/release";
import { storeMode } from "@/lib/store";
import { outcomeResponse, readReleaseRequest, storeFailure } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Anyone holding the grant (client or freelancer) can read the review state.
// If the window has passed while the record is still in review, this call
// releases the funds first (to the grant's payee only), then reports.
export async function POST(req: Request) {
  const parsed = await readReleaseRequest(req, { needsWindow: false });
  if ("response" in parsed) return parsed.response;
  const base = { storeMode: storeMode(), windowEnabled: windowEnabled() };
  if (!base.windowEnabled) {
    return NextResponse.json({ success: true, ...base, record: null, now: Date.now() });
  }
  try {
    const out = await releaseStatus(parsed.grant);
    return outcomeResponse(out, { ...base, now: Date.now() });
  } catch (e) {
    return storeFailure(e);
  }
}
