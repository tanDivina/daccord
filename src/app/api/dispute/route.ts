import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, askClaude, AiRefusal, UNTRUSTED_RULE } from "@/lib/ai";
import type { Criterion, Milestone } from "@/lib/types";

export const maxDuration = 60;

const DisputeSchema = z.object({
  classification: z.enum(["IN_SCOPE_DEFECT", "OUT_OF_SCOPE_EXPANSION", "MIXED"]),
  reasoning: z.string(),
  inScopeItems: z.array(z.string()).describe("Parts of the request covered by an agreed criterion, with the criterion id"),
  outOfScopeItems: z.array(z.string()),
  addOnMilestone: z
    .object({
      title: z.string(),
      criteria: z.array(z.string()).describe("Testable acceptance criteria for the new work"),
    })
    .nullable(),
});

const SYSTEM = `You arbitrate revision requests on fixed-scope milestone contracts.
Compare the client's request with the agreed acceptance criteria. Work that an agreed criterion covers is an in-scope defect the contractor must fix.
Work no criterion covers is an out-of-scope expansion: it cannot hold back payment for verified work and belongs in a new paid milestone.
Do not price new work; the parties agree on price.
${UNTRUSTED_RULE}`;

// Fallback when no model is configured: phrase matching, labeled as such.
const EXPANSION_PHRASES = ["also add", "also build", "can you also", "can we also", "new feature", "mobile app", "admin dashboard", "redesign", "additional pages"];

export async function POST(req: Request) {
  const { milestone, revisionRequest } = (await req.json()) as { milestone?: Milestone; revisionRequest?: string };
  const request = String(revisionRequest ?? "").slice(0, 4000);
  if (!milestone || !request.trim()) {
    return NextResponse.json({ success: false, error: "milestone and revisionRequest are required" }, { status: 400 });
  }

  if (!aiConfigured()) {
    const lower = request.toLowerCase();
    const hits = EXPANSION_PHRASES.filter((p) => lower.includes(p));
    return NextResponse.json({
      success: true,
      engine: "rules",
      classification: hits.length ? "OUT_OF_SCOPE_EXPANSION" : "IN_SCOPE_DEFECT",
      reasoning: hits.length
        ? `Phrase match (no AI configured): ${hits.join(", ")}.`
        : "No expansion phrases matched (no AI configured), so treated as a defect report.",
      inScopeItems: [],
      outOfScopeItems: [],
      addOnMilestone: null,
    });
  }

  try {
    const criteria = milestone.verifiableCriteria
      .map((c: Criterion) => `- [${c.id}] ${c.description} | target: ${c.targetMetric}`)
      .join("\n");
    const result = await askClaude({
      schema: DisputeSchema,
      system: SYSTEM,
      effort: "low",
      task: `Milestone: ${milestone.title} ($${milestone.amount})\n${milestone.summary}\n\nAgreed criteria:\n${criteria}\n\nThe client's revision request is below.`,
      untrusted: request,
    });
    return NextResponse.json({ success: true, engine: "claude", ...result });
  } catch (e) {
    console.error("[dispute]", e);
    const message = e instanceof AiRefusal ? `Model declined: ${e.message}` : "Dispute analysis failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
