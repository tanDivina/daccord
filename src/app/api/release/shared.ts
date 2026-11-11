import { NextResponse } from "next/server";
import { signingConfigured } from "@/lib/attestation";
import { readGrant } from "@/lib/grant";
import { WINDOW_DISABLED_NOTE, windowEnabled, type Outcome } from "@/lib/release";
import type { Grant } from "@/lib/types";

/** Reads the JSON body and the signed grant, or returns the error response. */
export async function readReleaseRequest(
  req: Request,
  opts: { needsWindow: boolean }
): Promise<{ body: Record<string, unknown>; grant: Grant } | { response: NextResponse }> {
  if (!signingConfigured()) {
    return { response: NextResponse.json({ success: false, error: "DACCORD_SIGNING_SECRET is not set" }, { status: 503 }) };
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return { response: NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }) };
  }
  const grant = readGrant(body.grant);
  if (!grant) {
    return {
      response: NextResponse.json({ success: false, error: "The milestone grant is missing, invalid or expired." }, { status: 403 }),
    };
  }
  if (opts.needsWindow && !windowEnabled()) {
    return { response: NextResponse.json({ success: false, error: WINDOW_DISABLED_NOTE }, { status: 409 }) };
  }
  return { body, grant };
}

/** Turns a state-machine outcome into the API response. */
export function outcomeResponse(out: Outcome | { ok: true; record: null }, extra: Record<string, unknown> = {}) {
  if (out.ok) {
    const arbiter = "arbiter" in out ? out.arbiter : undefined;
    return NextResponse.json({ success: true, record: out.record, ...(arbiter ? { arbiter } : {}), ...extra });
  }
  return NextResponse.json(
    {
      success: false,
      error: out.error,
      ...(out.record !== undefined ? { record: out.record } : {}),
      ...(out.releaseAt !== undefined ? { releaseAt: out.releaseAt } : {}),
    },
    { status: out.status }
  );
}

export function storeFailure(e: unknown) {
  console.error("[release] store error", e);
  return NextResponse.json({ success: false, error: "The review datastore is unavailable. Try again shortly." }, { status: 503 });
}
