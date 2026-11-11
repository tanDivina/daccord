export type VerificationType = "ci_test" | "ast_analysis" | "endpoint_health" | "ui_contract";

export interface Criterion {
  id: string;
  description: string;
  verificationType: VerificationType;
  targetMetric: string;
  /** Optional URL to probe for endpoint_health criteria. */
  probeUrl?: string;
}

export interface Milestone {
  id: string;
  title: string;
  amount: number;
  summary: string;
  verifiableCriteria: Criterion[];
  status: "pending_funding" | "funded" | "in_review" | "verified_released" | "disputed";
}

export interface Contract {
  title: string;
  budget: number;
  milestones: Milestone[];
}

export interface Submission {
  prUrl?: string;
  codePayload?: string;
  notes?: string;
  stagingUrl?: string;
}

/** Where a result came from, so the UI never presents a fallback as real. */
export type Engine = "claude" | "rules" | "simulated";

/** The milestone terms the client fixed before funding. */
export type GrantMilestone = Pick<Milestone, "id" | "title" | "summary" | "verifiableCriteria">;

/**
 * A signed milestone grant, issued by /api/escrow/authorize when the client
 * places the hold. It fixes what gets verified (criteria, probe URLs), how much
 * is paid, from which authorization and to whom. The verify route reads these
 * from the grant, never from the request body.
 */
export interface Grant {
  v: 1;
  milestone: GrantMilestone;
  /** Amount PayPal actually authorized (or the simulated hold amount). */
  amount: number;
  authorizationId: string;
  /** Contractor's PayPal email, chosen by the client. Lowercased. */
  receiver: string;
  /** Staging URL chosen by the client for health probes, if any. */
  stagingUrl?: string;
  /** GitHub repository ("owner/name") the work must land in, if the client set one. */
  repo?: string;
  contractTitle?: string;
  mode: "paypal" | "simulated";
  issuedAt: number;
  expiresAt: number;
}
