import { objectToRelease } from "@/lib/release";
import { outcomeResponse, readReleaseRequest, storeFailure } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The client objects during the window. The scope arbiter judges the reasons
// against the grant's signed criteria: an in-scope defect pauses the release
// until a new commit passes verification; an out-of-scope request is recorded
// but the clock keeps running. Needs the client key.
export async function POST(req: Request) {
  const parsed = await readReleaseRequest(req, { needsWindow: true });
  if ("response" in parsed) return parsed.response;
  try {
    return outcomeResponse(await objectToRelease(parsed.grant, parsed.body.clientKey, parsed.body.reasons));
  } catch (e) {
    return storeFailure(e);
  }
}
