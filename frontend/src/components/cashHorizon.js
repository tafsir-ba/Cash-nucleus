export const QUADRANTS = [
  { id: "confirmed_inflow", title: "Confirmed Inflows", tone: "emerald" },
  { id: "confirmed_outflow", title: "Confirmed Outflows", tone: "rose" },
  { id: "potential_inflow", title: "Potential Inflows", tone: "sky" },
  { id: "potential_outflow", title: "Potential Outflows", tone: "amber" },
];

export const formatCHF = (amount) =>
  new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount ?? 0);

export const formatCHFCompact = (amount) => {
  const value = amount ?? 0;
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value)}`;
};

const asUtcNoon = (value) => {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfDay = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const resolveExpectedDate = ({
  timingMode,
  timing_mode,
  expectedDate,
  expected_date,
  daysFromToday,
  days_from_today,
  today = startOfDay(),
}) => {
  const mode = timingMode || timing_mode || "date";
  const days = daysFromToday ?? days_from_today;
  const dateValue = expectedDate ?? expected_date;
  if (mode === "days") {
    if (days === "" || days == null || Number.isNaN(Number(days))) return null;
    const d = new Date(today);
    d.setDate(d.getDate() + Number(days));
    return d;
  }
  return asUtcNoon(dateValue);
};

export const toDateInputValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const d = asUtcNoon(value);
  if (!d) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const normalizeAmount = (value) => {
  if (value === "" || value === null || value === undefined) return "";
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "";
};

const normalizeDays = (value) => {
  if (value === "" || value === null || value === undefined) return value === "" ? "" : 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/** Display-only normalization for in-progress edits; analysis remains backend-driven. */
export const normalizeEntry = (entry, today = startOfDay()) => {
  const timingMode = entry.timing_mode || entry.timingMode || "date";
  const resolved = resolveExpectedDate({
    timingMode,
    expectedDate: entry.expected_date ?? entry.expectedDate,
    daysFromToday: entry.days_from_today ?? entry.daysFromToday,
    today,
  });
  return {
    ...entry,
    timing_mode: timingMode,
    amount: normalizeAmount(entry.amount),
    days_from_today: normalizeDays(entry.days_from_today ?? entry.daysFromToday),
    resolved_date: resolved ? toDateInputValue(resolved) : null,
  };
};

export const patchEntryForDisplay = (entries, entryId, patch, today = startOfDay()) =>
  entries.map((entry) =>
    entry.id === entryId ? normalizeEntry({ ...entry, ...patch }, today) : entry,
  );

export const reorderEntriesForDisplay = (entries, quadrant, items) => {
  const orderMap = Object.fromEntries(items.map((item) => [item.id, item.sort_order]));
  return [...entries]
    .map((entry) =>
      entry.quadrant === quadrant ? { ...entry, sort_order: orderMap[entry.id] ?? entry.sort_order } : entry,
    )
    .sort((a, b) => {
      if (a.quadrant !== b.quadrant) return a.quadrant.localeCompare(b.quadrant);
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
};

const buildTimestampDomain = (timestamps) => {
  const valid = timestamps.filter((t) => t != null && !Number.isNaN(t));
  if (!valid.length) return ["auto", "auto"];
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) {
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    return [min - monthMs, max + monthMs];
  }
  return [min, max];
};

export const buildLiquidityChartDomain = (timeline) =>
  buildTimestampDomain((timeline || []).map((p) => p.timestamp));

export const buildMatchChartDomain = (events, timeline = []) =>
  buildTimestampDomain([
    ...(events || []).map((e) => e.timestamp),
    ...(timeline || []).map((p) => p.timestamp),
  ]);

export const MATCH_QUADRANT_COLORS = {
  confirmed_inflow: "#34d399",
  confirmed_outflow: "#fb7185",
  potential_inflow: "#38bdf8",
  potential_outflow: "#fbbf24",
};

export const buildMatchScatterData = (events) =>
  (events || [])
    .filter((e) => e.timestamp != null && !Number.isNaN(e.timestamp))
    .map((event) => ({
      ...event,
      y: event.quadrant.endsWith("_inflow") ? event.amount : -event.amount,
    }));

export const enrichAnalysisPayload = (payload) => {
  if (!payload) return payload;
  const timeline = (payload.timeline || []).map((point) => ({
    ...point,
    timestamp: point.timestamp ?? (asUtcNoon(point.date)?.getTime() ?? null),
  }));
  const cash_match_events = (payload.cash_match_events || []).map((event) => ({
    ...event,
    timestamp: event.timestamp ?? (asUtcNoon(event.date)?.getTime() ?? null),
  }));
  return { ...payload, timeline, cash_match_events };
};

export const formatResolvedDateLabel = (entry) => {
  if (!entry?.resolved_date) return "—";
  const d = asUtcNoon(entry.resolved_date);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

export const parseAmountInput = (raw) => {
  if (raw === "" || raw == null) return null;
  const n = Number(String(raw).replace(/'/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

export const quadrantToneClass = (quadrant) => {
  if (quadrant === "confirmed_inflow") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (quadrant === "confirmed_outflow") return "text-rose-400 bg-rose-500/10 border-rose-500/20";
  if (quadrant === "potential_inflow") return "text-sky-400 bg-sky-500/10 border-sky-500/20";
  return "text-amber-400 bg-amber-500/10 border-amber-500/20";
};
