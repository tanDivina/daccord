import { NextResponse } from "next/server";

export interface Milestone {
  id: string;
  title: string;
  amount: number;
  summary: string;
  verifiableCriteria: {
    id: string;
    description: string;
    verificationType: "ci_test" | "ast_analysis" | "endpoint_health" | "ui_contract";
    targetMetric: string;
  }[];
  status: "pending_funding" | "funded" | "in_review" | "verified_released" | "disputed";
}

const PRESET_CONTRACTS: Record<string, { title: string; budget: number; milestones: Milestone[] }> = {
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
            description: "Orders v2 Authorize and Capture integration passes all sandbox integration tests",
            verificationType: "ci_test",
            targetMetric: "12/12 integration tests passing (coverage >= 85%)",
          },
          {
            id: "c2_2",
            description: "PayPal Webhook listener validates CRC32 / HMAC signatures against PayPal certs",
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { preset, prompt } = body;

    if (preset && PRESET_CONTRACTS[preset]) {
      return NextResponse.json({
        success: true,
        contract: PRESET_CONTRACTS[preset],
      });
    }

    // Dynamic fallback generation if custom prompt entered
    const defaultMilestones: Milestone[] = [
      {
        id: "m1",
        title: "Architecture Blueprint, Schemas & Core Setup",
        amount: 500,
        summary: "Foundational setup, linting configs, CI pipeline, and core data contracts.",
        verifiableCriteria: [
          {
            id: "c1_1",
            description: "Continuous Integration pipeline runs lint and unit test suite cleanly",
            verificationType: "ci_test",
            targetMetric: "Exit code 0, 0 linter errors",
          },
          {
            id: "c1_2",
            description: "Data schema definition covers all required entities specified in prompt",
            verificationType: "ast_analysis",
            targetMetric: "100% required fields covered",
          },
        ],
        status: "funded",
      },
      {
        id: "m2",
        title: "Core Feature Implementation & Integration",
        amount: 1000,
        summary: `Implementation of the core functionality: ${prompt ? prompt.slice(0, 100) : "Primary requirements"}...`,
        verifiableCriteria: [
          {
            id: "c2_1",
            description: "Feature integration passes automated test suite with coverage >= 80%",
            verificationType: "ci_test",
            targetMetric: ">= 80% line coverage",
          },
          {
            id: "c2_2",
            description: "Zero mock/placeholder functions in production code paths",
            verificationType: "ast_analysis",
            targetMetric: "Zero TODO/DUMMY handlers detected",
          },
        ],
        status: "funded",
      },
      {
        id: "m3",
        title: "Production Hardening, Polish & Delivery",
        amount: 500,
        summary: "Security validation, responsive testing, and live deployment verification.",
        verifiableCriteria: [
          {
            id: "c3_1",
            description: "Staging URL responds with HTTP 200 and passes SSL verification",
            verificationType: "endpoint_health",
            targetMetric: "HTTP 200 OK, valid SSL cert",
          },
        ],
        status: "pending_funding",
      },
    ];

    return NextResponse.json({
      success: true,
      contract: {
        title: prompt ? `Custom Contract: ${prompt.slice(0, 45)}...` : "Custom AI Contract",
        budget: 2000,
        milestones: defaultMilestones,
      },
    });
  } catch (_error) {
    return NextResponse.json(
      { success: false, error: "Failed to generate contract structure" },
      { status: 500 }
    );
  }
}
