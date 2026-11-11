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
  /**
   * Length of the client's review window after verification, in seconds.
   * Always 172800 (48h) for live PayPal holds; 120 only when the client chose
   * the demo window on a sandbox or simulated hold. Missing on grants signed
   * before the review window existed, which means 48h.
   */
  reviewWindowSec?: number;
  issuedAt: number;
  expiresAt: number;
}

/** What the client picked at funding. "demo2m" is refused for live PayPal holds. */
export type ReviewWindowChoice = "48h" | "demo2m";

export type ArbiterClassification = "IN_SCOPE_DEFECT" | "OUT_OF_SCOPE_EXPANSION" | "MIXED";

export interface ArbiterResult {
  /** "rules" means phrase matching because no model is configured. */
  engine: "claude" | "rules";
  classification: ArbiterClassification;
  reasoning: string;
  inScopeItems: string[];
  outOfScopeItems: string[];
  addOnMilestone: { title: string; criteria: string[] } | null;
}

export type ReleaseState = "review" | "changes_requested" | "released" | "escalated";
export type ReleasedBy = "client_approval" | "auto" | "freelancer_claim" | "cron";

export interface ReleaseObjection extends ArbiterResult {
  at: number;
  text: string;
  /** true for IN_SCOPE_DEFECT and MIXED: the release was paused (or escalated). */
  upheld: boolean;
}

export interface ReleaseReceipt {
  mode: "simulated" | "sandbox" | "live";
  captureId: string | null;
  captureStatus: string;
  payoutBatchId: string;
  batchStatus: string;
  transactionId?: string | null;
  transactionStatus?: string | null;
  fee?: string | null;
  amount: string;
  receiver: string;
  senderBatchId: string;
  elapsedMs: number;
}

/**
 * Review-window state for one held authorization, stored under
 * daccord:release:<authorizationId>. Times are epoch milliseconds.
 */
export interface ReleaseRecord {
  v: 1;
  authorizationId: string;
  state: ReleaseState;
  /** sha256 of the signed grant this record belongs to. */
  grantHash: string;
  verifiedAt: number;
  releaseAt: number;
  reviewWindowSec: number;
  attestationEvidenceHash: string;
  headSha?: string;
  objections: ReleaseObjection[];
  /** IN_SCOPE_DEFECT or MIXED objections so far (at most 2 before escalation). */
  upheldObjections: number;
  /** How many review windows were opened (1 + one per new verification after changes were requested). */
  reviews: number;
  /** Copied from the signed grant so the cron sweep can release without it. */
  payout: { milestoneId: string; amount: number; receiver: string; mode: Grant["mode"]; contractTitle?: string };
  grantExpiresAt: number;
  releasedBy?: ReleasedBy;
  releasedAt?: number;
  receipt?: ReleaseReceipt;
  /** Last failed release attempt (e.g. a PayPal error); the record stays in review. */
  lastError?: { at: number; message: string };
  /** Failed release attempts so far (the cron sweep stops retrying after a few). */
  releaseFailures?: number;
  /**
   * Set as soon as the authorization is captured, before the payout. Retries
   * then skip the capture, and objections are closed: the client's money has
   * already moved.
   */
  capture?: { id: string | null; status: string; at: number };
  /** Every commit that passed verification for this milestone; none of them can open a window after changes were requested. */
  reviewedShas?: string[];
}
