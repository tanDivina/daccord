import { NextResponse } from "next/server";
import { AiRefusal } from "@/lib/ai";
import { arbitrateRevision } from "@/lib/release";
import type { Milestone } from "@/lib/types";

export const maxDuration = 60;

// Advisory only: this route classifies a revision request and drafts an add-on
// milestone (the Threat lab and the dispute panel). It never reads or signs a
// grant or attestation and never calls PayPal, so nothing it returns can
// capture, release or refund funds. Objections during the review window go
// through /api/release/object, which uses the same arbiter against the grant's
// signed criteria instead of criteria from the request body.
export async function POST(req: Request) {
  const { milestone, revisionRequest } = ((await req.json().catch(() => ({}))) ?? {}) as {
    milestone?: Milestone;
    revisionRequest?: string;
  };
  const request = String(revisionRequest ?? "").slice(0, 4000);
  if (
    !milestone ||
    !Array.isArray(milestone.verifiableCriteria) ||
    milestone.verifiableCriteria.length > 20 ||
    JSON.stringify(milestone).length > 20_000 ||
    !request.trim()
  ) {
    return NextResponse.json({ success: false, error: "milestone and revisionRequest are required" }, { status: 400 });
  }

  try {
    const result = await arbitrateRevision(
      {
        title: String(milestone.title ?? ""),
        summary: String(milestone.summary ?? ""),
        amount: Number(milestone.amount) || 0,
        verifiableCriteria: milestone.verifiableCriteria,
      },
      request
    );
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error("[dispute]", e);
    const message = e instanceof AiRefusal ? `Model declined: ${e.message}` : "Dispute analysis failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
