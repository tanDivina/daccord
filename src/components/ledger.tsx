"use client";

import React, { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type ValueFormatterParams,
} from "ag-grid-community";
import type { LedgerQuery, LedgerRow } from "@/lib/ledger";

ModuleRegistry.registerModules([AllCommunityModule]);

const ledgerTheme = themeQuartz.withParams({
  backgroundColor: "#FFFDF4",
  foregroundColor: "#1A160F",
  headerBackgroundColor: "#F1EAD8",
  headerTextColor: "#1A160F",
  headerFontWeight: 600,
  oddRowBackgroundColor: "#FBF7EC",
  rowHoverColor: "rgba(168, 217, 18, 0.14)",
  selectedRowBackgroundColor: "rgba(168, 217, 18, 0.22)",
  accentColor: "#44560A",
  borderColor: "rgba(26, 22, 15, 0.15)",
  wrapperBorderRadius: 12,
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontSize: 12,
  rowHeight: 38,
  headerHeight: 40,
});

const STATUS_STYLE: Record<string, string> = {
  agreed: "bg-[#F1EAD8] text-[#4A443A] border-[#1A160F]/20",
  held: "bg-[#0070ba]/10 text-[#003087] border-[#0070ba]/40",
  pass: "bg-[#A8D912]/30 text-[#44560A] border-[#A8D912]",
  paid: "bg-[#A8D912] text-[#1A160F] border-[#1A160F]",
  fail: "bg-[#FBEAE7] text-[#B3402F] border-[#B3402F]/40",
  blocked: "bg-[#B3402F] text-[#FFFDF4] border-[#B3402F]",
  scoped: "bg-[#F6ECCB] text-[#8A6D00] border-[#8A6D00]/40",
  error: "bg-[#FBEAE7] text-[#B3402F] border-[#B3402F]/40",
};

function StatusCell({ value }: ICellRendererParams<LedgerRow, string>) {
  if (!value) return null;
  return (
    <span className={`inline-flex items-center h-5 leading-none px-2 rounded-full border text-[10px] font-mono uppercase tracking-wide ${STATUS_STYLE[value] ?? STATUS_STYLE.agreed}`}>
      {value}
    </span>
  );
}

function EngineCell({ value }: ICellRendererParams<LedgerRow, string>) {
  if (!value) return null;
  const real = value === "claude" || value === "sandbox" || value === "live";
  return <span className={`font-mono text-[11px] ${real ? "text-[#44560A]" : "text-[#8A6D00]"}`}>{value}</span>;
}

const money = (p: ValueFormatterParams<LedgerRow, number>) =>
  p.value == null ? "" : `$${p.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const time = (p: ValueFormatterParams<LedgerRow, string>) =>
  p.value ? new Date(p.value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

/** Turns the validated query into AG Grid's filter model. */
function toFilterModel(q: LedgerQuery) {
  const model: Record<string, unknown> = {};
  for (const f of q.filters) {
    if (f.column === "amount") {
      const n = Number(f.value);
      if (Number.isFinite(n)) model.amount = { filterType: "number", type: f.op === "contains" ? "equals" : f.op, filter: n };
    } else {
      model[f.column] = { filterType: "text", type: f.op === "greaterThan" || f.op === "lessThan" ? "contains" : f.op, filter: f.value };
    }
  }
  return model;
}

export function Ledger({ rows, onClear }: { rows: LedgerRow[]; onClear: () => void }) {
  const gridRef = useRef<AgGridReact<LedgerRow>>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ explanation: string; engine: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState("");

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "at", headerName: "Time", valueFormatter: time, width: 110, sort: "desc", filter: false },
      { field: "kind", headerName: "Event", width: 130, pinned: "left" },
      { field: "milestone", headerName: "Milestone", flex: 1, minWidth: 180 },
      { field: "criterion", headerName: "Criterion", flex: 1.4, minWidth: 220, tooltipField: "criterion" },
      { field: "status", headerName: "Status", width: 125, cellRenderer: StatusCell, cellStyle: { display: "flex", alignItems: "center" } },
      { field: "amount", headerName: "Amount", width: 120, valueFormatter: money, filter: "agNumberColumnFilter", type: "rightAligned" },
      { field: "paypalRef", headerName: "PayPal ID", width: 190, cellClass: "font-mono" },
      { field: "engine", headerName: "Source", width: 110, cellRenderer: EngineCell },
      { field: "detail", headerName: "Detail", flex: 2, minWidth: 260, tooltipField: "detail" },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: "agTextColumnFilter", floatingFilter: true }), []);

  const apply = (q: LedgerQuery) => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.setFilterModel(toFilterModel(q));
    api.applyColumnState({
      state: q.sort ? [{ colId: q.sort.column, sort: q.sort.direction }] : [{ colId: "at", sort: "desc" }],
      defaultState: { sort: null },
    });
  };

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const res = await fetch("/api/ledger/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the distinct milestone titles go along, so "the API milestone" can match a title. Never the rows.
        body: JSON.stringify({ question, milestones: Array.from(new Set(rows.map((r) => r.milestone))).slice(0, 30) }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      apply(data.query);
      setAnswer({ explanation: data.query.explanation, engine: data.engine });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setAsking(false);
    }
  };

  const reset = () => {
    apply({ filters: [], sort: null, explanation: "" });
    setAnswer(null);
    setQuestion("");
  };

  const held = rows.filter((r) => r.kind === "Funds held").reduce((s, r) => s + (r.amount ?? 0), 0);
  const paid = rows.filter((r) => r.kind === "Payout" && r.status === "paid").reduce((s, r) => s + (r.amount ?? 0), 0);
  const verdicts = rows.filter((r) => r.kind === "Verdict");
  const blocked = rows.filter((r) => r.status === "blocked").length;

  const tiles = [
    { label: "Held with PayPal", value: `$${held.toLocaleString("en-US")}` },
    { label: "Released", value: `$${paid.toLocaleString("en-US")}` },
    { label: "Criteria passed", value: `${verdicts.filter((r) => r.status === "pass").length} / ${verdicts.length}` },
    { label: "Attacks blocked", value: String(blocked) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-[#FFFDF4] border border-[#1A160F]/20 px-4 py-3">
            <p className="text-[11px] text-[#6B6353]">{t.label}</p>
            <p className="font-display text-2xl font-semibold text-[#1A160F] tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>

      <form onSubmit={ask} className="flex flex-col sm:flex-row gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Ask the ledger, e.g. "criteria the skeptic rejected" or "real PayPal events over $1,000"'
          className="flex-1 bg-[#FFFDF4] text-sm text-[#1A160F] placeholder:text-[#6B6353] border border-[#1A160F]/25 rounded-lg px-3 py-2.5 focus:border-[#1A160F] outline-none"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="px-4 py-2.5 rounded-lg bg-[#1A160F] text-[#F7F1E3] text-sm font-semibold disabled:opacity-40"
        >
          {asking ? "Reading…" : "Ask"}
        </button>
      </form>

      {(answer || error) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs rounded-lg border border-[#1A160F]/15 bg-[#F1EAD8] px-3 py-2">
          {error ? (
            <span className="text-[#B3402F]">{error}</span>
          ) : (
            <span className="text-[#4A443A]">
              <span className="font-mono text-[10px] uppercase mr-2 text-[#44560A]">{answer!.engine === "claude" ? "Claude" : "Keyword rules"}</span>
              {answer!.explanation}
            </span>
          )}
          <button onClick={reset} className="font-semibold text-[#1A160F] underline underline-offset-2">
            Clear filters
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Quick search"
          className="bg-[#FFFDF4] text-xs border border-[#1A160F]/25 rounded-lg px-3 py-1.5 outline-none focus:border-[#1A160F] w-48"
        />
        <div className="flex-1" />
        <button
          onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: "daccord-ledger.csv" })}
          disabled={!rows.length}
          className="px-3 py-1.5 rounded-lg border border-[#1A160F] text-xs font-semibold disabled:opacity-40"
        >
          Export CSV
        </button>
        <button onClick={onClear} disabled={!rows.length} className="px-3 py-1.5 rounded-lg text-xs text-[#6B6353] hover:text-[#B3402F] disabled:opacity-40">
          Clear ledger
        </button>
      </div>

      <div style={{ height: 480 }}>
        <AgGridReact<LedgerRow>
          ref={gridRef}
          theme={ledgerTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          quickFilterText={quick}
          tooltipShowDelay={300}
          animateRows
          overlayNoRowsTemplate="Nothing recorded yet. Load a contract, hold funds and verify a milestone in the Protocol demo."
        />
      </div>
      <p className="text-[11px] text-[#6B6353]">
        Every row comes from a real API response in this browser session and is stored only in this browser. Your question goes to the server with the milestone titles but not the rows;
        Claude turns it into a grid filter and sort.
      </p>
    </div>
  );
}
