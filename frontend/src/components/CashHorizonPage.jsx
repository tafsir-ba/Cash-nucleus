import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Plus,
  Trash,
  DotsSixVertical,
  Sparkle,
  WarningCircle,
  CheckCircle,
  ArrowDownLeft,
  ArrowUpRight,
} from "@phosphor-icons/react";
import {
  QUADRANTS,
  enrichAnalysisPayload,
  EMPTY_CASH_HORIZON_ANALYSIS,
  formatCHF,
  formatCHFCompact,
  formatResolvedDateLabel,
  parseAmountInput,
  parseOccurrenceCount,
  patchEntryForDisplay,
  reorderEntriesForDisplay,
  toDateInputValue,
} from "./cashHorizon";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const QUADRANT_META = {
  confirmed_inflow: {
    accent: "text-emerald-400",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    bar: "bg-emerald-400",
    Icon: ArrowDownLeft,
  },
  confirmed_outflow: {
    accent: "text-rose-400",
    chip: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    bar: "bg-rose-400",
    Icon: ArrowUpRight,
  },
  potential_inflow: {
    accent: "text-sky-400",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    bar: "bg-sky-400",
    Icon: ArrowDownLeft,
  },
  potential_outflow: {
    accent: "text-amber-400",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bar: "bg-amber-400",
    Icon: ArrowUpRight,
  },
};

const CELL =
  "w-full min-w-0 bg-transparent border border-transparent rounded px-2 py-1.5 text-sm text-zinc-100 transition-colors duration-200 focus:outline-none focus:bg-zinc-950 focus:border-zinc-600 hover:border-zinc-800";

const TH =
  "text-left px-2 py-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold whitespace-nowrap";

const TD = "px-1.5 py-1 align-middle";

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
  occurrence_count: 4,
  notes: "",
});

const amountTone = (value, positiveClass = "text-emerald-400") =>
  value < 0 ? "text-rose-400" : positiveClass;

const formatAsOf = (value) => {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

const KpiCard = ({ label, value, hint, toneClass, testId }) => (
  <div className="surface-card p-5 md:p-6 flex flex-col gap-2" data-testid={testId}>
    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">{label}</p>
    <p className={`text-3xl sm:text-4xl font-light tracking-tighter font-mono leading-none ${toneClass}`}>
      {formatCHF(value)}
    </p>
    <p className="text-xs text-zinc-600">{hint}</p>
  </div>
);

const QuadrantWorkspace = ({
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
  const [showNotes, setShowNotes] = useState(false);
  const meta = QUADRANT_META[quadrant];

  useEffect(() => {
    setDraft(emptyDraft(quadrant));
    setDragId(null);
  }, [quadrant]);

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
    const occurrenceCount =
      draft.timing_mode === "distributed" ? parseOccurrenceCount(draft.occurrence_count) : null;
    if (draft.timing_mode === "distributed" && occurrenceCount == null) {
      toast.error("Enter at least 2 occurrences");
      return;
    }
    await onAdd({
      quadrant,
      label: draft.label.trim(),
      amount,
      timing_mode: draft.timing_mode,
      expected_date: draft.timing_mode === "date" ? draft.expected_date : null,
      days_from_today: days,
      occurrence_count: occurrenceCount,
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
    occurrence_count: timing_mode === "distributed" ? entry.occurrence_count || 4 : entry.occurrence_count,
  });

  const renderWhenField = (entry) => {
    if (entry.timing_mode === "date") {
      return (
        <input
          type="date"
          value={entry.expected_date || ""}
          onChange={(e) => onUpdateLocal(entry.id, { expected_date: e.target.value })}
          onBlur={(e) => onSave(entry.id, { expected_date: e.target.value })}
          className={CELL}
        />
      );
    }
    if (entry.timing_mode === "distributed") {
      return (
        <input
          type="text"
          inputMode="numeric"
          value={entry.occurrence_count === "" ? "" : entry.occurrence_count ?? ""}
          onFocus={selectOnFocus}
          onChange={(e) => onUpdateLocal(entry.id, { occurrence_count: e.target.value })}
          onBlur={(e) => {
            const count = parseOccurrenceCount(e.target.value);
            if (count == null) {
              toast.error("Enter at least 2 occurrences");
              return;
            }
            onSave(entry.id, { occurrence_count: count });
          }}
          className={`${CELL} font-mono`}
          placeholder="# months"
          title="Number of monthly occurrences"
        />
      );
    }
    return (
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
    );
  };

  const renderDraftWhenField = () => {
    if (draft.timing_mode === "date") {
      return (
        <input
          type="date"
          value={draft.expected_date}
          onChange={(e) => setDraft((d) => ({ ...d, expected_date: e.target.value }))}
          onKeyDown={handleDraftKeyDown}
          className={`${CELL} bg-zinc-950/80 border-zinc-800`}
        />
      );
    }
    if (draft.timing_mode === "distributed") {
      return (
        <input
          type="text"
          inputMode="numeric"
          value={draft.occurrence_count === "" ? "" : draft.occurrence_count}
          onFocus={selectOnFocus}
          onChange={(e) => setDraft((d) => ({ ...d, occurrence_count: e.target.value }))}
          onKeyDown={handleDraftKeyDown}
          className={`${CELL} bg-zinc-950/80 border-zinc-800 font-mono`}
          placeholder="# months"
          title="Number of monthly occurrences"
        />
      );
    }
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft.days_from_today === "" ? "" : draft.days_from_today}
        onFocus={selectOnFocus}
        onChange={(e) => setDraft((d) => ({ ...d, days_from_today: e.target.value }))}
        onKeyDown={handleDraftKeyDown}
        className={`${CELL} bg-zinc-950/80 border-zinc-800 font-mono`}
        placeholder="Days"
      />
    );
  };

  const colCount = showNotes ? 8 : 7;

  return (
    <div className="surface-card overflow-hidden" data-testid={`quadrant-workspace-${quadrant}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`h-8 w-1 rounded-full ${meta.bar}`} aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-100 font-heading truncate">{title}</h3>
            <p className="text-xs text-zinc-500">
              {totals?.entry_count || 0} {(totals?.entry_count || 0) === 1 ? "item" : "items"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors duration-200 ${
              showNotes
                ? "border-zinc-600 text-zinc-200 bg-zinc-800/60"
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {showNotes ? "Hide notes" : "Show notes"}
          </button>
          <p className={`text-lg font-mono font-light tracking-tight ${meta.accent}`}>
            {formatCHF(totals?.total_amount || 0)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="overflow-y-auto max-h-[min(420px,50vh)]">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm">
              <tr className="border-b border-zinc-800">
                <th className={`${TH} w-8`} aria-label="Reorder" />
                <th className={`${TH} min-w-[160px]`}>Label</th>
                <th className={`${TH} w-[110px]`}>Amount</th>
                <th className={`${TH} w-[108px]`}>Timing</th>
                <th className={`${TH} w-[130px]`}>When</th>
                <th className={`${TH} min-w-[140px]`}>Resolved</th>
                {showNotes && <th className={`${TH} min-w-[140px]`}>Notes</th>}
                <th className={`${TH} w-10`} aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-zinc-600">
                    No entries in this bucket yet. Add one below.
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
                  className={`border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors duration-200 ${
                    savingId === entry.id ? "opacity-60" : ""
                  }`}
                >
                  <td className={TD}>
                    <DotsSixVertical size={14} className="text-zinc-600 cursor-grab mx-auto" />
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
                      className={`${CELL} font-mono text-right tabular-nums`}
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
                      <option value="distributed">Distributed</option>
                    </select>
                  </td>
                  <td className={TD}>{renderWhenField(entry)}</td>
                  <td className={`${TD} px-2 text-xs text-zinc-500 font-mono whitespace-nowrap`}>
                    {formatResolvedDateLabel(entry)}
                  </td>
                  {showNotes && (
                    <td className={TD}>
                      <input
                        value={entry.notes || ""}
                        onChange={(e) => onUpdateLocal(entry.id, { notes: e.target.value })}
                        onBlur={(e) => onSave(entry.id, { notes: e.target.value })}
                        className={`${CELL} text-zinc-400`}
                        placeholder="—"
                      />
                    </td>
                  )}
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => onDelete(entry.id)}
                      className="p-1.5 text-zinc-600 hover:text-rose-400 mx-auto block rounded transition-colors duration-200"
                      title="Delete"
                    >
                      <Trash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-zinc-800 bg-zinc-950/70 px-2 py-2" data-testid="quick-add-form">
          <div className="grid grid-cols-[auto_minmax(0,1.4fr)_110px_88px_130px_auto] gap-1.5 items-center min-w-[640px]">
            <span className="w-8 flex justify-center text-zinc-600">
              <Plus size={14} />
            </span>
            <input
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              onKeyDown={handleDraftKeyDown}
              className={`${CELL} bg-zinc-950/80 border-zinc-800`}
              placeholder="New label"
            />
            <input
              type="text"
              inputMode="decimal"
              value={draft.amount}
              onFocus={selectOnFocus}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              onKeyDown={handleDraftKeyDown}
              className={`${CELL} bg-zinc-950/80 border-zinc-800 font-mono text-right`}
              placeholder="Amount"
            />
            <select
              value={draft.timing_mode}
              onChange={(e) => setDraft((d) => ({ ...d, timing_mode: e.target.value }))}
              className={`${CELL} bg-zinc-950/80 border-zinc-800`}
            >
              <option value="date">Date</option>
              <option value="days">Days</option>
              <option value="distributed">Distributed</option>
            </select>
            {renderDraftWhenField()}
            <button
              type="button"
              onClick={submitDraft}
              className="justify-self-end px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-100 text-zinc-900 hover:bg-white transition-colors duration-200"
              data-testid="quick-add-submit"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const CashHorizonPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(EMPTY_CASH_HORIZON_ANALYSIS);
  const [savingId, setSavingId] = useState(null);
  const [activeQuadrant, setActiveQuadrant] = useState(QUADRANTS[0].id);

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

  const firstGap = useMemo(
    () => (analysis.checkpoints || []).find((row) => row.is_negative_combined) || null,
    [analysis.checkpoints],
  );

  const activeMeta = QUADRANTS.find((q) => q.id === activeQuadrant) || QUADRANTS[0];
  const asOfLabel = formatAsOf(analysis.as_of);
  const outlookNegative = analysis.positions.combined_outlook < 0;

  if (loading) {
    return (
      <div className="text-sm text-zinc-500 py-16 text-center" data-testid="cash-horizon-loading">
        Loading Cash Horizon...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-rose-400 py-16 text-center" data-testid="cash-horizon-error">
        {error}
      </div>
    );
  }

  const { positions, checkpoints, summary } = analysis;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto" data-testid="cash-horizon-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-50 font-heading">
            Cash Horizon
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
            Liquidity outlook across confirmed and potential cash flows — decide first, edit below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {asOfLabel && (
            <span className="text-xs text-zinc-500 font-mono px-2.5 py-1 rounded-md border border-zinc-800">
              As of {asOfLabel}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border ${
              outlookNegative
                ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
            data-testid="outlook-status"
          >
            {outlookNegative ? <WarningCircle size={14} /> : <CheckCircle size={14} />}
            {outlookNegative ? "Gap pressure" : "Surplus outlook"}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Position summary">
        <KpiCard
          label="Confirmed net"
          value={positions.confirmed_net_position}
          hint="Inflows − outflows that are locked in"
          toneClass={amountTone(positions.confirmed_net_position)}
          testId="kpi-confirmed-net"
        />
        <KpiCard
          label="Potential net"
          value={positions.potential_net_position}
          hint="Upside and risk not yet confirmed"
          toneClass={amountTone(positions.potential_net_position, "text-sky-400")}
          testId="kpi-potential-net"
        />
        <KpiCard
          label="Overall outlook"
          value={positions.combined_outlook}
          hint="Confirmed net + potential net"
          toneClass={amountTone(positions.combined_outlook, "text-zinc-50")}
          testId="kpi-overall-outlook"
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-6">
        <div className="xl:col-span-8 surface-card overflow-hidden" data-testid="horizon-runway">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-medium text-zinc-100 font-heading">Horizon runway</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Cumulative position by checkpoint</p>
            </div>
            {firstGap ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300">
                <WarningCircle size={12} />
                First gap by {firstGap.horizon}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                <CheckCircle size={12} />
                No projected gaps
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]" data-testid="table-horizon">
              <thead>
                <tr className="border-b border-zinc-800">
                  {["Horizon", "Confirmed in", "Confirmed out", "Confirmed net", "Potential net", "Combined"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((row) => {
                  const isFirstGap = firstGap && row.horizon === firstGap.horizon;
                  return (
                    <tr
                      key={row.horizon}
                      className={`border-b border-zinc-800/70 transition-colors duration-200 hover:bg-zinc-800/30 ${
                        isFirstGap ? "bg-rose-500/[0.06]" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 text-sm text-zinc-200 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {row.horizon}
                          {isFirstGap && (
                            <span className="text-[10px] uppercase tracking-wider text-rose-400">Gap</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm font-mono text-zinc-400 tabular-nums">
                        {formatCHFCompact(row.confirmed_inflows)}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-mono text-zinc-400 tabular-nums">
                        {formatCHFCompact(row.confirmed_outflows)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-sm font-mono tabular-nums ${
                          row.is_negative_confirmed ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        {formatCHF(row.confirmed_net)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-sm font-mono tabular-nums ${
                          row.potential_net < 0 ? "text-rose-400" : "text-sky-400"
                        }`}
                      >
                        {formatCHF(row.potential_net)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-sm font-mono tabular-nums font-medium ${
                          row.is_negative_combined ? "text-rose-400" : "text-zinc-100"
                        }`}
                      >
                        {formatCHF(row.combined_position)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="xl:col-span-4 pressure-panel flex flex-col" data-testid="liquidity-brief">
          <div className="flex items-center gap-2 mb-4">
            <Sparkle size={16} className="text-zinc-300" />
            <h2 className="text-sm font-medium text-zinc-100 font-heading">Liquidity brief</h2>
          </div>
          <ul className="space-y-3 flex-1">
            {(summary || []).map((line) => (
              <li key={line} className="flex gap-2.5 text-sm text-zinc-300 leading-relaxed">
                <span className="mt-2 h-1 w-1 rounded-full bg-zinc-500 shrink-0" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="space-y-3" aria-label="Cash horizon matrix">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-medium tracking-[0.16em] uppercase text-zinc-400">
              Matrix workspace
            </h2>
            <p className="text-xs text-zinc-600 mt-1">Edit one flow bucket at a time — totals stay visible for all four.</p>
          </div>
        </div>

        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-2"
          role="tablist"
          aria-label="Flow buckets"
          data-testid="quadrant-switcher"
        >
          {QUADRANTS.map(({ id, title }) => {
            const meta = QUADRANT_META[id];
            const totals = analysis.quadrant_totals[id];
            const active = activeQuadrant === id;
            const Icon = meta.Icon;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveQuadrant(id)}
                className={`text-left rounded-lg border p-3 transition-all duration-200 ${
                  active
                    ? "border-zinc-600 bg-zinc-900/80 scale-[0.99]"
                    : "border-zinc-800 bg-zinc-900/20 hover:border-zinc-700 hover:bg-zinc-900/40"
                }`}
                data-testid={`quadrant-tab-${id}`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon size={14} className={meta.accent} />
                  <span className="text-[11px] uppercase tracking-wider text-zinc-400 truncate">{title}</span>
                </div>
                <p className={`text-base font-mono font-light tracking-tight ${meta.accent}`}>
                  {formatCHF(totals?.total_amount || 0)}
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{totals?.entry_count || 0} items</p>
              </button>
            );
          })}
        </div>

        <QuadrantWorkspace
          key={activeQuadrant}
          quadrant={activeQuadrant}
          title={activeMeta.title}
          totals={analysis.quadrant_totals[activeQuadrant]}
          entries={entriesByQuadrant[activeQuadrant] || []}
          onAdd={handleAdd}
          onUpdateLocal={handleUpdateLocal}
          onSave={handleSave}
          onDelete={handleDelete}
          onReorder={handleReorder}
          savingId={savingId}
        />
      </section>
    </div>
  );
};
