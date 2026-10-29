import { z } from "zod";

/** One audit row. Every row is built from a real API response in the browser. */
export interface LedgerRow {
  id: string;
  at: string;
  kind: "Contract" | "Criterion" | "Funds held" | "Verification" | "Verdict" | "Payout" | "Threat lab";
  milestone: string;
  criterion?: string;
  status: "agreed" | "held" | "pass" | "fail" | "blocked" | "scoped" | "paid" | "error";
  amount?: number;
  paypalRef?: string;
  /** Where the result came from: claude, rules, sandbox, live, simulated, preset. */
  engine: string;
  detail: string;
}

export const LEDGER_COLUMNS = ["kind", "milestone", "criterion", "status", "amount", "paypalRef", "engine", "detail"] as const;

export const LedgerQuerySchema = z.object({
  filters: z
    .array(
      z.object({
        column: z.enum(LEDGER_COLUMNS),
        op: z.enum(["contains", "notContains", "equals", "notEqual", "greaterThan", "lessThan"]),
        value: z.string(),
      })
    )
    .describe("All filters must match (AND). At most one filter per column."),
  sort: z
    .object({ column: z.enum([...LEDGER_COLUMNS, "at"]), direction: z.enum(["asc", "desc"]) })
    .nullable(),
  explanation: z.string().describe("One short sentence telling the user what the grid now shows"),
});

export type LedgerQuery = z.infer<typeof LedgerQuerySchema>;

export const LEDGER_SCHEMA_DOC = `Columns of the D'accord ledger grid:
- kind: one of "Contract", "Criterion" (agreed acceptance criterion), "Funds held" (PayPal authorization), "Verification" (one verify run), "Verdict" (one criterion's result in a run), "Payout" (capture + PayPal Payouts), "Threat lab" (attack test)
- milestone: milestone title
- criterion: criterion text (Criterion and Verdict rows)
- status: one of agreed, held, pass, fail, blocked (security alert stopped the payout), scoped (dispute classified), paid, error
- amount: number in USD
- paypalRef: PayPal authorization ID or payout batch ID; simulated ones start with "SIM-"
- engine: claude, rules, sandbox, live, simulated or preset
- detail: free text with evidence, the skeptic's concern, or the alert type (PROMPT_INJECTION_DETECTED, FAKE_OR_MOCKED_DELIVERABLE)
- at: ISO timestamp`;

/** Keyword fallback when no model is configured. Labeled "rules" in the UI. */
export function ruleBasedQuery(question: string): LedgerQuery {
  const q = question.toLowerCase();
  const filters: LedgerQuery["filters"] = [];
  const statuses = ["pass", "fail", "blocked", "paid", "held", "agreed", "scoped"] as const;
  const status = statuses.find((s) => new RegExp(`\\b${s}(ed|ing)?\\b`).test(q)) ?? (/\b(reject|failed)\b/.test(q) ? "fail" : undefined);
  if (status) filters.push({ column: "status", op: "equals", value: status });
  if (/\b(payout|paid out|released)\b/.test(q)) filters.push({ column: "kind", op: "equals", value: "Payout" });
  else if (/\b(attack|threat|injection)\b/.test(q)) filters.push({ column: "kind", op: "equals", value: "Threat lab" });
  else if (/\bcriteri(on|a)\b/.test(q) && status !== "agreed") filters.push({ column: "kind", op: "equals", value: "Verdict" });
  if (/\bsimulated\b/.test(q)) filters.push({ column: "engine", op: "equals", value: "simulated" });
  else if (/\b(real|sandbox)\b/.test(q)) filters.push({ column: "paypalRef", op: "notContains", value: "SIM-" });
  const over = q.match(/\b(over|above|more than)\s*\$?([\d,]+)/);
  if (over) filters.push({ column: "amount", op: "greaterThan", value: over[2].replace(/,/g, "") });
  return {
    filters,
    sort: /\b(largest|biggest|highest)\b/.test(q) ? { column: "amount", direction: "desc" } : null,
    explanation: filters.length ? `Keyword match on ${filters.map((f) => f.column).join(", ")}.` : "No keywords recognized, showing everything.",
  };
}

// Row builders, one per API response. Contract rows get stable ids so reloading
// the same contract doesn't duplicate them; event rows are unique per response.
const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface ContractLike {
  title: string;
  milestones: { id: string; title: string; amount: number; verifiableCriteria: { id: string; description: string }[] }[];
}

export function contractRows(contract: ContractLike, engine: string): LedgerRow[] {
  const key = contract.title.toLowerCase().replace(/\W+/g, "-").slice(0, 40);
  const at = now();
  return contract.milestones.flatMap((m) => [
    { id: `c-${key}-${m.id}`, at, kind: "Contract" as const, milestone: m.title, status: "agreed" as const, amount: m.amount, engine, detail: `${contract.title}: ${m.verifiableCriteria.length} criteria agreed` },
    ...m.verifiableCriteria.map((c) => ({
      id: `c-${key}-${m.id}-${c.id}`, at, kind: "Criterion" as const, milestone: m.title, criterion: c.description, status: "agreed" as const, engine, detail: c.id,
    })),
  ]);
}

export function holdRow(milestone: string, escrow: { mode: string; authorizationId: string; status: string; amount: number; expirationTime?: string }): LedgerRow {
  return {
    id: `h-${escrow.authorizationId}`, at: now(), kind: "Funds held", milestone, status: "held", amount: escrow.amount, paypalRef: escrow.authorizationId, engine: escrow.mode,
    detail: `Authorization ${escrow.status}${escrow.expirationTime ? `, expires ${new Date(escrow.expirationTime).toLocaleString("en-US")}` : ""}`,
  };
}

export function verifyRows(milestone: string, amount: number, data: any, kind: "Verification" | "Threat lab" = "Verification"): LedgerRow[] {
  const at = now();
  const run = uid("v");
  if (!data?.success) return [{ id: run, at, kind, milestone, status: "error", engine: data?.engine ?? "n/a", detail: data?.error ?? "Verification failed" }];
  const alert = data.securityAlert?.flagged ? data.securityAlert : null;
  const head: LedgerRow = {
    id: run, at, kind, milestone, amount, engine: data.engine,
    status: alert ? "blocked" : data.verified ? "pass" : "fail",
    detail: alert ? `${alert.type}: ${alert.explanation}` : `${data.summary}${data.attestation ? " Attestation signed." : data.attestationError ? ` ${data.attestationError}` : ""}`,
  };
  if (kind === "Threat lab") return [head];
  const verdicts = (data.criteriaResults ?? []).map((c: any): LedgerRow => ({
    id: `${run}-${c.id}`, at, kind: "Verdict", milestone, criterion: c.description, engine: data.engine,
    status: c.passed ? "pass" : "fail",
    detail: c.concern ? `Skeptic: ${c.concern}` : c.evidence,
  }));
  return [head, ...verdicts];
}

export function payoutRow(milestone: string, data: any): LedgerRow {
  const r = data?.receipt;
  if (!data?.success || !r) return { id: uid("p"), at: now(), kind: "Payout", milestone, status: "error", engine: data?.mode ?? "n/a", detail: data?.error ?? "Payout failed" };
  return {
    id: `p-${r.payoutBatchId}`, at: now(), kind: "Payout", milestone, status: "paid", amount: Number(r.amount), paypalRef: r.payoutBatchId, engine: data.mode,
    detail: `Capture ${r.captureId} ${r.captureStatus}; batch ${r.batchStatus}; sent to ${r.receiver}`,
  };
}

export function disputeRow(milestone: string, data: any): LedgerRow {
  return data?.success
    ? { id: uid("d"), at: now(), kind: "Threat lab", milestone, status: "scoped", engine: data.engine, detail: `Dispute: ${data.classification}. ${data.reasoning ?? ""}`.trim() }
    : { id: uid("d"), at: now(), kind: "Threat lab", milestone, status: "error", engine: "n/a", detail: data?.error ?? "Dispute check failed" };
}
