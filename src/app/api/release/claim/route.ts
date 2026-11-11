import { claimRelease } from "@/lib/release";
import { outcomeResponse, readReleaseRequest, storeFailure } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The freelancer's "Claim payment" button. Needs nothing secret: anyone may
// trigger a release once the window has passed, and the money only goes to the
// grant's payee. Before releaseAt it answers 409 with releaseAt.
export async function POST(req: Request) {
  const parsed = await readReleaseRequest(req, { needsWindow: true });
  if ("response" in parsed) return parsed.response;
  try {
    return outcomeResponse(await claimRelease(parsed.grant));
  } catch (e) {
    return storeFailure(e);
  }
}
