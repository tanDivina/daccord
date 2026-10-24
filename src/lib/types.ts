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
