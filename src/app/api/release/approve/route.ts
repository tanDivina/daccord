import { approveRelease } from "@/lib/release";
import { outcomeResponse, readReleaseRequest, storeFailure } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The client releases the funds before the window ends. Needs the client key
// returned by /api/escrow/authorize.
export async function POST(req: Request) {
  const parsed = await readReleaseRequest(req, { needsWindow: true });
  if ("response" in parsed) return parsed.response;
  try {
    return outcomeResponse(await approveRelease(parsed.grant, parsed.body.clientKey));
  } catch (e) {
    return storeFailure(e);
  }
}
