import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, askClaude, AiRefusal } from "@/lib/ai";
import type { Contract, Milestone } from "@/lib/types";

export const maxDuration = 60;

const PRESET_CONTRACTS: Record<string, Contract> = {
  ecommerce_api: {
    title: "PayPal Orders & Subscriptions Backend Microservice",
    budget: 2400,
    milestones: [
      {
        id: "m1",
        title: "Auth & Database Schema with Migration Scripts",
        amount: 600,
        summary: "PostgreSQL schemas, Prisma migrations, and JWT bearer auth with rate limiting.",
        verifiableCriteria: [
          {
            id: "c1_1",
            description: "Database migration runs successfully with zero rollback errors in test DB",
            verificationType: "ci_test",
            targetMetric: "Exit code 0, 100% tables created",
          },
          {
            id: "c1_2",
            description: "Authentication middleware enforces signature validation on protected routes",
            verificationType: "ast_analysis",
            targetMetric: "401 returned on forged / expired bearer token",
          },
        ],
        status: "funded",
      },
      {
        id: "m2",
        title: "PayPal Orders v2 & Webhook Reconciliation Engine",
        amount: 1000,
        summary: "Full PayPal checkout pipeline with idempotency keys and HMAC webhook verification.",
        verifiableCriteria: [
          {
            id: "c2_1",
            description: "Orders v2 Authorize and Capture integration passes all automated CI integration tests",
            verificationType: "ci_test",
            targetMetric: "12/12 integration tests passing in CI with status: success",
          },
          {
            id: "c2_2",
            description: "Webhook listener verifies every event with PayPal verify-webhook-signature before trusting it",
            verificationType: "ast_analysis",
            targetMetric: "Rejects unverified webhook payloads with HTTP 400",
          },
          {
            id: "c2_3",
            description: "Live health check endpoint reports healthy database and PayPal gateway connection",
            verificationType: "endpoint_health",
            targetMetric: "GET /api/health -> 200 OK within 250ms",
          },
        ],
        status: "funded",
      },
      {
        id: "m3",
        title: "Load Testing, Error Recovery & Production Staging",
        amount: 800,
        summary: "Stress testing under 500 RPS with automatic retry queues and deployment to staging.",
        verifiableCriteria: [
          {
            id: "c3_1",
            description: "K6 load testing under 500 concurrent virtual users maintains p95 < 350ms",
            verificationType: "ci_test",
            targetMetric: "p95 <= 350ms, 0% drop rate",
          },
          {
            id: "c3_2",
            description: "Staging deployment responds with live API OpenAPI spec",
            verificationType: "endpoint_health",
            targetMetric: "GET /docs returns 200 with complete swagger JSON",
          },
        ],
        status: "pending_funding",
      },
    ],
  },
  ai_agent_app: {
    title: "Autonomous Procurement Agent with LangGraph & PayPal Fastlane",
    budget: 3200,
    milestones: [
      {
        id: "m1",
        title: "Tool-Calling Architecture & Product Catalog Scraper",
        amount: 1000,
        summary: "LangGraph state machine with search tools and item extraction schema.",
        verifiableCriteria: [
          {
            id: "c1_1",
            description: "LangGraph agent correctly executes search and extraction tool loops",
            verificationType: "ci_test",
            targetMetric: "State graph terminates with structured JSON candidate list",
          },
        ],
        status: "funded",
      },
      {
        id: "m2",
        title: "Fastlane Checkout Tool & Spending Limit Enforcer",
        amount: 1200,
        summary: "Vaulted pre-approval with strict cryptographic budget ceilings.",
        verifiableCriteria: [
          {
            id: "c2_1",
            description: "Agent halts and requests human signature if order exceeds $250 limit",
            verificationType: "ast_analysis",
            targetMetric: "Hard ceiling enforced; cannot bypass limit",
          },
          {
            id: "c2_2",
            description: "Sandbox checkout completes order with mocked customer Fastlane profile",
            verificationType: "ci_test",
            targetMetric: "PayPal order ID generated and stored in SQLite/Postgres",
          },
        ],
        status: "funded",
      },
      {
        id: "m3",
        title: "End-to-End Chat UI & Slack Notification Webhooks",
        amount: 1000,
        summary: "Responsive dashboard with interactive approval cards and receipt delivery.",
        verifiableCriteria: [
          {
            id: "c3_1",
            description: "Lighthouse mobile accessibility score >= 90",
            verificationType: "ui_contract",
            targetMetric: "Audit score >= 90",
          },
        ],
        status: "pending_funding",
      },
    ],
  },
};

const ContractSchema = z.object({
  title: z.string(),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        amount: z.number().describe("USD, whole dollars"),
        summary: z.string(),
        criteria: z.array(
          z.object({
            description: z.string(),
            verificationType: z.enum(["ci_test", "ast_analysis", "endpoint_health", "ui_contract"]),
            targetMetric: z.string().describe("A pass/fail threshold a machine or reviewer can check"),
          })
        ),
      })
    )
    .describe("2 to 5 milestones"),
});

const SYSTEM = `You turn a freelance job description into milestone contracts whose acceptance criteria can be checked from a pull request, CI results or a live URL.
Each criterion must be concrete and pass/fail: name the test, file, endpoint or threshold. Avoid criteria that need subjective judgment.
Split the budget across milestones so the amounts add up to it exactly. If no budget is given, propose a realistic one.`;

export async function POST(req: Request) {
  try {
    const { preset, prompt, budget } = await req.json();

    if (preset && PRESET_CONTRACTS[preset]) {
      return NextResponse.json({ success: true, engine: "preset", contract: PRESET_CONTRACTS[preset] });
    }

    const description = String(prompt ?? "").trim().slice(0, 6000);
    if (!description) {
      return NextResponse.json({ success: false, error: "Describe the job or pick a preset" }, { status: 400 });
    }
    if (!aiConfigured()) {
      return NextResponse.json(
        { success: false, error: "Custom contracts need ANTHROPIC_API_KEY. Pick a preset instead." },
        { status: 503 }
      );
    }

    const draft = await askClaude({
      schema: ContractSchema,
      system: SYSTEM,
      effort: "low",
      task: `Budget: ${Number(budget) > 0 ? `$${Number(budget)}` : "not specified"}\n\nJob description:\n${description}`,
    });

    const milestones: Milestone[] = draft.milestones.map((m, i) => ({
      id: `m${i + 1}`,
      title: m.title,
      amount: Math.round(m.amount),
      summary: m.summary,
      status: "pending_funding",
      verifiableCriteria: m.criteria.map((c, j) => ({ id: `c${i + 1}_${j + 1}`, ...c })),
    }));
    const contract: Contract = {
      title: draft.title,
      budget: milestones.reduce((sum, m) => sum + m.amount, 0),
      milestones,
    };
    return NextResponse.json({ success: true, engine: "claude", contract });
  } catch (e) {
    console.error("[contract/parse]", e);
    const message = e instanceof AiRefusal ? `Model declined: ${e.message}` : "Failed to generate contract";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
