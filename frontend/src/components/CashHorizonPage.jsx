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
  ZAxis,
} from "recharts";
import {
  QUADRANTS,
  analyzeCashHorizon,
  buildLiquidityChartDomain,
  enrichAnalysisPayload,
  formatCHF,
  formatCHFCompact,
  quadrantToneClass,
  toDateInputValue,
} from "./cashHorizon";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const toneBorder = {
  confirmed_inflow: "border-emerald-500/30",
  confirmed_outflow: "border-rose-500/30",
  potential_inflow: "border-sky-500/30",
  potential_outflow: "border-amber-500/30",
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
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    await onAdd({
      quadrant,
      label: draft.label.trim(),
      amount,
      timing_mode: draft.timing_mode,
      expected_date: draft.timing_mode === "date" ? draft.expected_date : null,
      days_from_today: draft.timing_mode === "days" ? Number(draft.days_from_today) : null,
      notes: draft.notes?.trim() || null,
    });
    setDraft(emptyDraft(quadrant));
  };

  return (
    <div className={`rounded-lg border bg-zinc-900/30 p-4 ${toneBorder[quadrant]}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          <p className="text-lg font-mono text-zinc-50 mt-1">{formatCHF(totals?.total_amount || 0)}</p>
          <p className="text-xs text-zinc-500">{totals?.entry_count || 0} items</p>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            draggable
            onDragStart={() => setDragId(entry.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(entry.id)}
            className={`rounded-md border border-zinc-800 bg-zinc-950/70 p-2 space-y-2 ${
              savingId === entry.id ? "opacity-70" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <DotsSixVertical size={14} className="text-zinc-600 shrink-0 cursor-grab" />
              <input
                value={entry.label}
                onChange={(e) => onUpdateLocal(entry.id, { label: e.target.value })}
                onBlur={(e) => onSave(entry.id, { label: e.target.value })}
                className="flex-1 bg-transparent border-b border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                placeholder="Label"
              />
              <button
                type="button"
                onClick={() => onDelete(entry.id)}
                className="p-1 text-zinc-500 hover:text-rose-400"
                title="Delete entry"
              >
                <Trash size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={entry.amount}
                onChange={(e) => onUpdateLocal(entry.id, { amount: Number(e.target.value) })}
                onBlur={(e) => onSave(entry.id, { amount: Number(e.target.value) })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-100"
                placeholder="Amount"
              />
              <select
                value={entry.timing_mode}
                onChange={(e) => {
                  const timing_mode = e.target.value;
                  const patch = {
                    timing_mode,
                    expected_date: timing_mode === "date" ? entry.expected_date || toDateInputValue(new Date()) : entry.expected_date,
                    days_from_today: timing_mode === "days" ? entry.days_from_today ?? 30 : entry.days_from_today,
                  };
                  onUpdateLocal(entry.id, patch);
                  onSave(entry.id, patch);
                }}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                <option value="date">Expected date</option>
                <option value="days">Days from today</option>
              </select>
            </div>
            {entry.timing_mode === "date" ? (
              <input
                type="date"
                value={entry.expected_date || ""}
                onChange={(e) => onUpdateLocal(entry.id, { expected_date: e.target.value })}
                onBlur={(e) => onSave(entry.id, { expected_date: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200"
              />
            ) : (
              <input
                type="number"
                min="0"
                value={entry.days_from_today ?? 0}
                onChange={(e) => onUpdateLocal(entry.id, { days_from_today: Number(e.target.value) })}
                onBlur={(e) => onSave(entry.id, { days_from_today: Number(e.target.value) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200"
                placeholder="Days from today"
              />
            )}
            <input
              value={entry.notes || ""}
              onChange={(e) => onUpdateLocal(entry.id, { notes: e.target.value })}
              onBlur={(e) => onSave(entry.id, { notes: e.target.value })}
              className="w-full bg-transparent border-b border-zinc-800 text-xs text-zinc-400 focus:outline-none focus:border-zinc-600"
              placeholder="Notes (optional)"
            />
            <p className="text-[10px] text-zinc-600 font-mono">Resolved: {entry.resolved_date || "—"}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-dashed border-zinc-700 p-3 space-y-2">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Add entry</p>
        <input
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100"
          placeholder="Label"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="number"
            min="0"
            value={draft.amount}
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-100"
            placeholder="Amount"
          />
          <select
            value={draft.timing_mode}
            onChange={(e) => setDraft((d) => ({ ...d, timing_mode: e.target.value }))}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200"
          >
            <option value="date">Expected date</option>
            <option value="days">Days from today</option>
          </select>
        </div>
        {draft.timing_mode === "date" ? (
          <input
            type="date"
            value={draft.expected_date}
            onChange={(e) => setDraft((d) => ({ ...d, expected_date: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200"
          />
        ) : (
          <input
            type="number"
            min="0"
            value={draft.days_from_today}
            onChange={(e) => setDraft((d) => ({ ...d, days_from_today: Number(e.target.value) }))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200"
          />
        )}
        <button
          type="button"
          onClick={submitDraft}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 text-xs font-medium hover:bg-white"
        >
          <Plus size={14} />
          Add entry
        </button>
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
  const [analysis, setAnalysis] = useState(() => analyzeCashHorizon([]));
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API}/cash-horizon`);
      setAnalysis(response.data);
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

  const optimisticUpdate = (nextEntries) => {
    setAnalysis(analyzeCashHorizon(nextEntries));
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
    const nextEntries = analysis.entries.map((entry) =>
      entry.id === entryId ? { ...entry, ...patch } : entry,
    );
    optimisticUpdate(nextEntries);
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
    const orderMap = Object.fromEntries(items.map((item) => [item.id, item.sort_order]));
    const nextEntries = analysis.entries
      .map((entry) =>
        entry.quadrant === quadrant ? { ...entry, sort_order: orderMap[entry.id] ?? entry.sort_order } : entry,
      )
      .sort((a, b) => {
        if (a.quadrant !== b.quadrant) return a.quadrant.localeCompare(b.quadrant);
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
    optimisticUpdate(nextEntries);
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
    [analysis.entries],
  );

  const liquidityDomain = useMemo(
    () => buildLiquidityChartDomain(analysis.timeline),
    [analysis.timeline],
  );

  const matchScatter = useMemo(
    () =>
      analysis.cash_match_events.map((event) => ({
        ...event,
        y: event.quadrant.endsWith("_inflow") ? event.amount : -event.amount,
      })),
    [analysis.cash_match_events],
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
              <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={liquidityDomain}
                  tickFormatter={(ts) => new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}
                  stroke="#71717a"
                  tick={{ fontSize: 10 }}
                />
                <YAxis stroke="#71717a" tick={{ fontSize: 10 }} tickFormatter={formatCHFCompact} width={48} />
                <ZAxis range={[70, 70]} />
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
                {QUADRANTS.map(({ id }) => (
                  <Scatter
                    key={id}
                    name={id}
                    data={matchScatter.filter((e) => e.quadrant === id)}
                    fill={
                      id === "confirmed_inflow"
                        ? "#34d399"
                        : id === "confirmed_outflow"
                          ? "#fb7185"
                          : id === "potential_inflow"
                            ? "#38bdf8"
                            : "#fbbf24"
                    }
                  />
                ))}
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
