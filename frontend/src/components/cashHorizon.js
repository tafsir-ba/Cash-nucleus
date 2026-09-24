export const QUADRANTS = [
  { id: "confirmed_inflow", title: "Confirmed Inflows", tone: "emerald" },
  { id: "confirmed_outflow", title: "Confirmed Outflows", tone: "rose" },
  { id: "potential_inflow", title: "Potential Inflows", tone: "sky" },
  { id: "potential_outflow", title: "Potential Outflows", tone: "amber" },
];

export const EMPTY_CASH_HORIZON_ANALYSIS = {
  as_of: "",
  entries: [],
  quadrant_totals: {},
  positions: {
    confirmed_inflows: 0,
    confirmed_outflows: 0,
    potential_inflows: 0,
    potential_outflows: 0,
    confirmed_net_position: 0,
    potential_net_position: 0,
    combined_outlook: 0,
  },
  checkpoints: [],
  timeline: [],
  cash_match_events: [],
  summary: [],
};

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

const addMonths = (date, months) => {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Clamp overflow (e.g. Jan 31 + 1 month)
  if (d.getDate() < day) d.setDate(0);
  return d;
};

export const resolveExpectedDate = ({
  timingMode,
  timing_mode,
  expectedDate,
  expected_date,
  daysFromToday,
  days_from_today,
  occurrenceCount,
  occurrence_count,
  today = startOfDay(),
}) => {
  const mode = timingMode || timing_mode || "date";
  const days = daysFromToday ?? days_from_today;
  const dateValue = expectedDate ?? expected_date;
  const count = occurrenceCount ?? occurrence_count;
  if (mode === "days") {
    if (days === "" || days == null || Number.isNaN(Number(days))) return null;
    const d = new Date(today);
    d.setDate(d.getDate() + Number(days));
    return d;
  }
  if (mode === "distributed") {
    if (count === "" || count == null || Number.isNaN(Number(count)) || Number(count) < 1) return null;
    const start = dateValue ? asUtcNoon(dateValue) : today;
    if (!start) return null;
    // Convert UTC noon Date to local calendar components for addMonths when from asUtcNoon
    const startLocal =
      dateValue && start instanceof Date
        ? new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
        : start;
    return addMonths(startLocal, Number(count) - 1);
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

const normalizeOccurrenceCount = (value) => {
  if (value === "" || value === null || value === undefined) return value === "" ? "" : null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

/** Display-only normalization for in-progress edits; analysis remains backend-driven. */
export const normalizeEntry = (entry, today = startOfDay()) => {
  const timingMode = entry.timing_mode || entry.timingMode || "date";
  const occurrenceCount = normalizeOccurrenceCount(entry.occurrence_count ?? entry.occurrenceCount);
  const amount = normalizeAmount(entry.amount);
  const resolved = resolveExpectedDate({
    timingMode,
    expectedDate: entry.expected_date ?? entry.expectedDate,
    daysFromToday: entry.days_from_today ?? entry.daysFromToday,
    occurrenceCount,
    today,
  });
  const perOccurrence =
    timingMode === "distributed" && occurrenceCount >= 1 && amount !== ""
      ? Math.round((Number(amount) / occurrenceCount) * 100) / 100
      : entry.per_occurrence_amount ?? null;
  return {
    ...entry,
    timing_mode: timingMode,
    amount,
    days_from_today: normalizeDays(entry.days_from_today ?? entry.daysFromToday),
    occurrence_count: occurrenceCount,
    expected_date:
      timingMode === "distributed"
        ? entry.expected_date ?? entry.expectedDate ?? toDateInputValue(today)
        : entry.expected_date ?? entry.expectedDate,
    per_occurrence_amount: perOccurrence,
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

export const enrichAnalysisPayload = (payload) => payload;

export const formatResolvedDateLabel = (entry) => {
  if (entry?.timing_mode === "distributed") {
    const count = Number(entry.occurrence_count);
    if (!Number.isFinite(count) || count < 1) return "—";
    const per =
      entry.per_occurrence_amount != null && entry.per_occurrence_amount !== ""
        ? Number(entry.per_occurrence_amount)
        : entry.amount !== "" && entry.amount != null
          ? Number(entry.amount) / count
          : null;
    const perLabel = per != null && Number.isFinite(per) ? formatCHFCompact(per) : "—";
    const formatDay = (iso) =>
      asUtcNoon(iso)?.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }) || null;
    const start = entry.expected_date ? formatDay(entry.expected_date) : null;
    const end = entry.resolved_date ? formatDay(entry.resolved_date) : null;
    if (start && end) {
      return `${count}× ${perLabel}/mo · ${start} → ${end}`;
    }
    if (end) return `${count}× ${perLabel}/mo · ${end}`;
    return `${count}× ${perLabel}/mo`;
  }
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

export const parseOccurrenceCount = (raw) => {
  if (raw === "" || raw == null) return null;
  const n = Number(String(raw).replace(/'/g, ""));
  return Number.isFinite(n) && n >= 2 ? Math.round(n) : null;
};
