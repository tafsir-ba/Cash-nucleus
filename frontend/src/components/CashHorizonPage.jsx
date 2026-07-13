import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash, DotsSixVertical, Sparkle } from "@phosphor-icons/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  ScatterChart,
  Scatter,
  Cell,
} from "recharts";
import {
  QUADRANTS,
  buildLiquidityChartDomain,
  buildMatchChartDomain,
  buildMatchScatterData,
  enrichAnalysisPayload,
  EMPTY_CASH_HORIZON_ANALYSIS,
  formatCHF,
  formatCHFCompact,
  formatResolvedDateLabel,
  MATCH_QUADRANT_COLORS,
  parseAmountInput,
  patchEntryForDisplay,
  quadrantToneClass,
  reorderEntriesForDisplay,
  toDateInputValue,
} from "./cashHorizon";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const toneBorder = {
  confirmed_inflow: "border-emerald-500/30",
  confirmed_outflow: "border-rose-500/30",
  potential_inflow: "border-sky-500/30",
  potential_outflow: "border-amber-500/30",
};

const CELL =
  "w-full min-w-0 bg-zinc-950/80 border border-zinc-800/70 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600";

const TH =
  "text-left px-1.5 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium whitespace-nowrap";

const TD = "px-1 py-0.5 align-middle";

const selectOnFocus = (event) => {
  event.target.select();
};

const emptyDraft = (quadrant) => ({
  quadrant,
  label: "",
  amount: "",
  timing_mode: "date",
  expected_date: toDateInputValue(new Date()),
  days_from_today: 30,
  notes: "",
});

const QuadrantPanel = ({
  quadrant,
  title,
  totals,
  entries,
  onAdd,
  onUpdateLocal,
  onSave,
  onDelete,
  onReorder,
  savingId,
}) => {
  const [draft, setDraft] = useState(emptyDraft(quadrant));
  const [dragId, setDragId] = useState(null);

  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    const ids = entries.map((e) => e.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(
      quadrant,
      next.map((entry, index) => ({ id: entry.id, sort_order: index })),
    );
    setDragId(null);
  };

  const submitDraft = async () => {
    if (!draft.label.trim()) {
      toast.error("Label is required");
      return;
    }
    const amount = parseAmountInput(draft.amount);
    if (amount == null) {
      toast.error("Enter a valid amount");
      return;
    }
    const days = draft.timing_mode === "days" ? parseAmountInput(draft.days_from_today) : null;
    if (draft.timing_mode === "days" && days == null) {
      toast.error("Enter valid days");
      return;
    }
    await onAdd({
      quadrant,
      label: draft.label.trim(),
      amount,
      timing_mode: draft.timing_mode,
      expected_date: draft.timing_mode === "date" ? draft.expected_date : null,
      days_from_today: days,
      notes: draft.notes?.trim() || null,
    });
    setDraft(emptyDraft(quadrant));
  };

  const handleDraftKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitDraft();
    }
  };

  const applyTimingModeChange = (entry, timing_mode) => ({
    timing_mode,
    expected_date: timing_mode === "date" ? entry.expected_date || toDateInputValue(new Date()) : entry.expected_date,
    days_from_today: timing_mode === "days" ? entry.days_from_today ?? 30 : entry.days_from_today,
  });

  return (
    <div className={`rounded-lg border bg-zinc-900/20 p-2 ${toneBorder[quadrant]}`}>
      <div className="flex items-baseline justify-between gap-2 px-1 mb-1.5">
        <h3 className="text-xs font-medium text-zinc-200">{title}</h3>
        <div className="text-right">
          <p className="text-sm font-mono text-zinc-50 leading-tight">{formatCHF(totals?.total_amount || 0)}</p>
          <p className="text-[10px] text-zinc-500">{totals?.entry_count || 0} items</p>
        </div>
      </div>

      <div className="rounded border border-zinc-800/80 overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[340px]">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm">
              <tr className="border-b border-zinc-800">
                <th className={`${TH} w-6`} aria-label="Reorder" />
                <th className={`${TH} min-w-[140px]`}>Label</th>
                <th className={`${TH} w-[88px]`}>Amount</th>
                <th className={`${TH} w-[72px]`}>Type</th>
                <th className={`${TH} w-[120px]`}>Date / Days</th>
                <th className={`${TH} w-[96px]`}>Resolved</th>
                <th className={`${TH} min-w-[100px]`}>Notes</th>
                <th className={`${TH} w-8`} aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-center text-[11px] text-zinc-600">
                    No entries yet — use the row below
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  draggable
                  onDragStart={() => setDragId(entry.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(entry.id)}
                  className={`border-b border-zinc-800/50 hover:bg-zinc-900/40 ${savingId === entry.id ? "opacity-60" : ""}`}
                >
                  <td className={TD}>
                    <DotsSixVertical size={12} className="text-zinc-600 cursor-grab mx-auto" />
                  </td>
                  <td className={TD}>
                    <input
                      value={entry.label}
                      onChange={(e) => onUpdateLocal(entry.id, { label: e.target.value })}
                      onBlur={(e) => onSave(entry.id, { label: e.target.value.trim() })}
                      className={CELL}
                      placeholder="Label"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={entry.amount === "" ? "" : entry.amount}
                      onFocus={selectOnFocus}
                      onChange={(e) => onUpdateLocal(entry.id, { amount: e.target.value })}
                      onBlur={(e) => {
                        const amount = parseAmountInput(e.target.value);
                        if (amount == null) {
                          toast.error("Enter a valid amount");
                          return;
                        }
                        onSave(entry.id, { amount });
                      }}
                      className={`${CELL} font-mono text-right`}
                      placeholder="0"
                    />
                  </td>
                  <td className={TD}>
                    <select
                      value={entry.timing_mode}
                      onChange={(e) => {
                        const patch = applyTimingModeChange(entry, e.target.value);
                        onUpdateLocal(entry.id, patch);
                        onSave(entry.id, patch);
                      }}
                      className={CELL}
                    >
                      <option value="date">Date</option>
                      <option value="days">Days</option>
                    </select>
                  </td>
                  <td className={TD}>
                    {entry.timing_mode === "date" ? (
                      <input
                        type="date"
                        value={entry.expected_date || ""}
                        onChange={(e) => onUpdateLocal(entry.id, { expected_date: e.target.value })}
                        onBlur={(e) => onSave(entry.id, { expected_date: e.target.value })}
                        className={CELL}
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={entry.days_from_today === "" ? "" : entry.days_from_today ?? ""}
                        onFocus={selectOnFocus}
                        onChange={(e) => onUpdateLocal(entry.id, { days_from_today: e.target.value })}
                        onBlur={(e) => {
                          const days = parseAmountInput(e.target.value);
                          if (days == null) {
                            toast.error("Enter valid days");
                            return;
                          }
                          onSave(entry.id, { days_from_today: days });
                        }}
                        className={`${CELL} font-mono`}
                        placeholder="0"
                      />
                    )}
                  </td>
                  <td className={`${TD} text-[11px] text-zinc-500 font-mono whitespace-nowrap`}>
                    {formatResolvedDateLabel(entry)}
                  </td>
                  <td className={TD}>
                    <input
                      value={entry.notes || ""}
                      onChange={(e) => onUpdateLocal(entry.id, { notes: e.target.value })}
                      onBlur={(e) => onSave(entry.id, { notes: e.target.value })}
                      className={`${CELL} text-zinc-400`}
                      placeholder="—"
                    />
                  </td>
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => onDelete(entry.id)}
                      className="p-0.5 text-zinc-600 hover:text-rose-400 mx-auto block"
                      title="Delete"
                    >
                      <Trash size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <table className="w-full min-w-[720px] border-collapse bg-zinc-950/80 border-t border-zinc-700/80">
          <tbody>
            <tr>
              <td className={`${TD} w-6`} />
              <td className={TD}>
                <input
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  onKeyDown={handleDraftKeyDown}
                  className={CELL}
                  placeholder="Label"
                />
              </td>
              <td className={TD}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.amount}
                  onFocus={selectOnFocus}
                  onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                  onKeyDown={handleDraftKeyDown}
                  className={`${CELL} font-mono text-right`}
                  placeholder="Amount"
                />
              </td>
              <td className={TD}>
                <select
                  value={draft.timing_mode}
                  onChange={(e) => setDraft((d) => ({ ...d, timing_mode: e.target.value }))}
                  className={CELL}
                >
                  <option value="date">Date</option>
                  <option value="days">Days</option>
                </select>
              </td>
              <td className={TD}>
                {draft.timing_mode === "date" ? (
                  <input
                    type="date"
                    value={draft.expected_date}
                    onChange={(e) => setDraft((d) => ({ ...d, expected_date: e.target.value }))}
                    onKeyDown={handleDraftKeyDown}
                    className={CELL}
                  />
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.days_from_today === "" ? "" : draft.days_from_today}
                    onFocus={selectOnFocus}
                    onChange={(e) => setDraft((d) => ({ ...d, days_from_today: e.target.value }))}
                    onKeyDown={handleDraftKeyDown}
                    className={`${CELL} font-mono`}
                    placeholder="Days"
                  />
                )}
              </td>
              <td className={`${TD} text-[10px] text-zinc-600 w-[96px]`}>—</td>
              <td className={TD}>
                <input
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  onKeyDown={handleDraftKeyDown}
                  className={`${CELL} text-zinc-400`}
                  placeholder="Notes"
                />
              </td>
              <td className={`${TD} w-8`}>
                <button
                  type="button"
                  onClick={submitDraft}
                  className="p-0.5 text-zinc-400 hover:text-zinc-100 mx-auto block"
                  title="Add entry"
                >
                  <Plus size={14} weight="bold" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LiquidityTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs">
      <p className="text-zinc-400 mb-1">{point.label || point.date}</p>
      <p className="text-zinc-100 font-mono">Confirmed: {formatCHF(point.confirmed_liquidity)}</p>
      <p className="text-zinc-100 font-mono">Combined: {formatCHF(point.combined_liquidity)}</p>
    </div>
  );
};

export const CashHorizonPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(EMPTY_CASH_HORIZON_ANALYSIS);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API}/cash-horizon`);
      setAnalysis(enrichAnalysisPayload(response.data));
    } catch {
      setError("Unable to load Cash Horizon data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyAnalysis = (data) => {
    setAnalysis(enrichAnalysisPayload(data));
  };

  const patchEntryLocally = (entryId, patch) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entries: patchEntryForDisplay(prev.entries, entryId, patch),
      };
    });
  };

  const reorderEntriesLocally = (quadrant, items) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entries: reorderEntriesForDisplay(prev.entries, quadrant, items),
      };
    });
  };

  const handleAdd = async (payload) => {
    try {
      const response = await axios.post(`${API}/cash-horizon/entries`, payload);
      applyAnalysis(response.data);
      toast.success("Entry added");
    } catch {
      toast.error("Failed to add entry");
      load();
    }
  };

  const handleUpdateLocal = (entryId, patch) => {
    patchEntryLocally(entryId, patch);
  };

  const handleSave = async (entryId, patch) => {
    setSavingId(entryId);
    try {
      const response = await axios.put(`${API}/cash-horizon/entries/${entryId}`, patch);
      applyAnalysis(response.data);
    } catch {
      toast.error("Failed to save entry");
      load();
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (entryId) => {
    try {
      const response = await axios.delete(`${API}/cash-horizon/entries/${entryId}`);
      applyAnalysis(response.data);
      toast.success("Entry deleted");
    } catch {
      toast.error("Failed to delete entry");
      load();
    }
  };

  const handleReorder = async (quadrant, items) => {
    reorderEntriesLocally(quadrant, items);
    try {
      const response = await axios.put(`${API}/cash-horizon/entries/reorder`, { quadrant, items });
      applyAnalysis(response.data);
    } catch {
      toast.error("Failed to reorder entries");
      load();
    }
  };

  const entriesByQuadrant = useMemo(
    () =>
      Object.fromEntries(
        QUADRANTS.map(({ id }) => [
          id,
          analysis.entries.filter((entry) => entry.quadrant === id),
        ]),
      ),
    [analysis],
  );

  const liquidityDomain = useMemo(
    () => buildLiquidityChartDomain(analysis.timeline),
    [analysis],
  );

  const matchDomain = useMemo(
    () => buildMatchChartDomain(analysis.cash_match_events, analysis.timeline),
    [analysis],
  );

  const matchScatter = useMemo(
    () => buildMatchScatterData(analysis.cash_match_events),
    [analysis],
  );

  if (loading) {
    return <div className="text-sm text-zinc-500 py-12 text-center">Loading Cash Horizon...</div>;
  }

  if (error) {
    return <div className="text-sm text-rose-400 py-12 text-center">{error}</div>;
  }

  const { positions, checkpoints, summary } = analysis;

  return (
    <div className="space-y-6" data-testid="cash-horizon-page">
      <div>
        <h1 className="text-lg font-heading text-zinc-100">Cash Horizon</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Compare expected inflows and outflows to understand future liquidity, timing gaps, and best-case outlook.
        </p>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-[0.15em] text-zinc-500 mb-3">Cash Horizon Matrix</h2>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {QUADRANTS.map(({ id, title }) => (
            <QuadrantPanel
              key={id}
              quadrant={id}
              title={title}
              totals={analysis.quadrant_totals[id]}
              entries={entriesByQuadrant[id]}
              onAdd={handleAdd}
              onUpdateLocal={handleUpdateLocal}
              onSave={handleSave}
              onDelete={handleDelete}
              onReorder={handleReorder}
              savingId={savingId}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-[0.15em] text-zinc-500">Liquidity Analysis</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="surface-card p-4">
            <p className="text-xs text-zinc-500 mb-1">Current Net Position</p>
            <p className={`text-2xl font-mono ${positions.confirmed_net_position < 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {formatCHF(positions.confirmed_net_position)}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">Confirmed inflows minus confirmed outflows</p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs text-zinc-500 mb-1">Potential Net Position</p>
            <p className={`text-2xl font-mono ${positions.potential_net_position < 0 ? "text-rose-400" : "text-sky-400"}`}>
              {formatCHF(positions.potential_net_position)}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">Potential inflows minus potential outflows</p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs text-zinc-500 mb-1">Overall Outlook</p>
            <p className={`text-2xl font-mono ${positions.combined_outlook < 0 ? "text-rose-400" : "text-zinc-100"}`}>
              {formatCHF(positions.combined_outlook)}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">Confirmed net + potential net</p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-zinc-900">
              <tr className="border-b border-zinc-800">
                {["Horizon", "Confirmed In", "Confirmed Out", "Confirmed Net", "Potential Net", "Combined"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-xs uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((row) => (
                <tr key={row.horizon} className="border-b border-zinc-800/70">
                  <td className="px-3 py-2 text-sm text-zinc-200">{row.horizon}</td>
                  <td className="px-3 py-2 text-sm font-mono text-zinc-300">{formatCHFCompact(row.confirmed_inflows)}</td>
                  <td className="px-3 py-2 text-sm font-mono text-zinc-300">{formatCHFCompact(row.confirmed_outflows)}</td>
                  <td className={`px-3 py-2 text-sm font-mono ${row.is_negative_confirmed ? "text-rose-400" : "text-emerald-400"}`}>
                    {formatCHF(row.confirmed_net)}
                  </td>
                  <td className={`px-3 py-2 text-sm font-mono ${row.potential_net < 0 ? "text-rose-400" : "text-sky-400"}`}>
                    {formatCHF(row.potential_net)}
                  </td>
                  <td className={`px-3 py-2 text-sm font-mono ${row.is_negative_combined ? "text-rose-400 bg-rose-500/5" : "text-zinc-100"}`}>
                    {formatCHF(row.combined_position)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkle size={16} className="text-violet-400" />
            <h3 className="text-sm font-medium text-zinc-100">AI Liquidity Summary</h3>
          </div>
          <ul className="space-y-2 text-sm text-zinc-300 list-disc ml-5">
            {summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="chart-container p-4">
          <h3 className="text-xs uppercase tracking-[0.15em] text-zinc-500 mb-3">Liquidity Timeline</h3>
          <div className="flex flex-wrap gap-3 mb-2 text-[10px] text-zinc-500">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" />Confirmed Liquidity</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-100" />Confirmed + Potential</span>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analysis.timeline} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={liquidityDomain}
                  tickFormatter={(ts) => new Date(ts).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
                  stroke="#71717a"
                  tick={{ fontSize: 10 }}
                />
                <YAxis stroke="#71717a" tick={{ fontSize: 10 }} tickFormatter={formatCHFCompact} width={48} />
                <Tooltip content={<LiquidityTooltip />} />
                <ReferenceLine y={0} stroke="#fb7185" strokeDasharray="4 4" strokeOpacity={0.5} />
                <Line type="linear" dataKey="confirmed_liquidity" stroke="#34d399" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="linear" dataKey="combined_liquidity" stroke="#fafafa" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-container p-4">
          <h3 className="text-xs uppercase tracking-[0.15em] text-zinc-500 mb-3">Cash Match Timeline</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart data={matchScatter} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={matchDomain}
                  tickFormatter={(ts) => new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}
                  stroke="#71717a"
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  dataKey="y"
                  type="number"
                  stroke="#71717a"
                  tick={{ fontSize: 10 }}
                  tickFormatter={formatCHFCompact}
                  width={48}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded p-2 text-xs">
                        <p className="text-zinc-300">{p.label}</p>
                        <p className="text-zinc-100 font-mono">{formatCHF(p.amount)}</p>
                        <p className="text-zinc-500">{p.quadrant_label}</p>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 4" />
                <Scatter dataKey="y" fill="#34d399" isAnimationActive={false}>
                  {matchScatter.map((point) => (
                    <Cell key={point.id} fill={MATCH_QUADRANT_COLORS[point.quadrant] || "#a1a1aa"} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mb-2 text-[10px] text-zinc-500">
            {QUADRANTS.map(({ id, title }) => (
              <span key={id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${quadrantToneClass(id)}`}>
                {title}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
