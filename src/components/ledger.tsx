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

const SUGGESTIONS = [
  "criteria the skeptic rejected",
  "criteria that failed verification",
  "attacks that were blocked",
  "funds still held with PayPal",
  "payouts sent to the freelancer",
  "real PayPal events over $1,000",
  "simulated events only",
  "verdicts Claude passed, newest first",
  "largest amounts first",
  "agreed criteria not yet verified",
];

/** Suggestions whose words start with what was typed; prefix matches of the whole phrase first. */
function matchSuggestions(input: string, extra: string[]) {
  const all = [...SUGGESTIONS, ...extra];
  const q = input.trim().toLowerCase();
  if (!q) return all.slice(0, 6);
  const typed = q.split(/\s+/);
  const words = (s: string) => s.toLowerCase().split(/[\s,]+/);
  return all
    .filter((s) => s.toLowerCase() !== q && typed.every((t) => words(s).some((w) => w.startsWith(t.replace(/[^\w$]/g, "")))))
    .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)))
    .slice(0, 6);
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const milestoneSuggestions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.milestone).filter(Boolean))).slice(0, 4).map((m) => `everything for ${m}`),
    [rows]
  );
  const matches = matchSuggestions(question, milestoneSuggestions);
  // Inline completion: the rest of the top suggestion, when it continues what was typed.
  const ghost =
    question && matches[0]?.toLowerCase().startsWith(question.toLowerCase()) ? matches[0].slice(question.length) : "";

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

  const pick = (text: string) => {
    setQuestion(text);
    setMenuOpen(false);
    setHighlight(-1);
    runQuery(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const atEnd = e.currentTarget.selectionStart === question.length;
    if ((e.key === "Tab" || (e.key === "ArrowRight" && atEnd)) && ghost) {
      e.preventDefault();
      setQuestion(question + ghost);
    } else if (e.key === "ArrowDown" && matches.length) {
      e.preventDefault();
      setMenuOpen(true);
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp" && matches.length) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? matches.length - 1 : h - 1));
    } else if (e.key === "Enter" && menuOpen && highlight >= 0 && matches[highlight]) {
      e.preventDefault();
      pick(matches[highlight]);
    } else if (e.key === "Escape") {
      setMenuOpen(false);
      setHighlight(-1);
    }
  };

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    runQuery(question);
  };

  const runQuery = async (question: string) => {
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
        <div className="relative flex-1">
          {/* Ghost text sits behind the transparent input and shows the inline completion. */}
          <div aria-hidden className="absolute inset-0 rounded-lg bg-[#FFFDF4] border border-transparent px-3 py-2.5 text-sm whitespace-pre overflow-hidden pointer-events-none">
            <span className="invisible">{question}</span>
            <span className="text-[#6B6353]/60">{ghost}</span>
          </div>
          <input
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setMenuOpen(true);
              setHighlight(-1);
            }}
            onFocus={() => setMenuOpen(true)}
            onBlur={() => setMenuOpen(false)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={menuOpen && matches.length > 0}
            aria-controls="ledger-suggestions"
            aria-autocomplete="both"
            aria-activedescendant={highlight >= 0 ? `ledger-sugg-${highlight}` : undefined}
            autoComplete="off"
            placeholder='Ask the ledger, e.g. "criteria the skeptic rejected" or "real PayPal events over $1,000"'
            className="relative w-full bg-transparent text-sm text-[#1A160F] placeholder:text-[#6B6353] border border-[#1A160F]/25 rounded-lg px-3 py-2.5 focus:border-[#1A160F] outline-none"
          />
          {menuOpen && matches.length > 0 && (
            <ul
              id="ledger-suggestions"
              role="listbox"
              className="absolute z-20 left-0 right-0 mt-1.5 py-1 rounded-lg bg-[#FFFDF4] border border-[#1A160F] shadow-paper-sm overflow-hidden"
            >
              {!question.trim() && <li className="px-3 pt-1.5 pb-1 text-[10px] font-mono uppercase tracking-wide text-[#6B6353]">Try asking</li>}
              {matches.map((m, i) => (
                <li
                  key={m}
                  id={`ledger-sugg-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  // mousedown, not click, so the input's blur doesn't close the menu first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`px-3 py-2 text-sm cursor-pointer ${i === highlight ? "bg-[#A8D912]/30 text-[#1A160F]" : "text-[#4A443A]"}`}
                >
                  {m}
                </li>
              ))}
              {ghost && <li className="px-3 pt-1 pb-1.5 text-[10px] text-[#6B6353]">Tab to complete · Enter to ask</li>}
            </ul>
          )}
        </div>
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
