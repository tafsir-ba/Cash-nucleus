export const QUADRANTS = [
  { id: "confirmed_inflow", title: "Confirmed Inflows", tone: "emerald" },
  { id: "confirmed_outflow", title: "Confirmed Outflows", tone: "rose" },
  { id: "potential_inflow", title: "Potential Inflows", tone: "sky" },
  { id: "potential_outflow", title: "Potential Outflows", tone: "amber" },
];

export const DEFAULT_CHECKPOINT_DAYS = [0, 7, 30, 60, 90, 180, 365];

const QUADRANT_LABELS = Object.fromEntries(QUADRANTS.map((q) => [q.id, q.title]));

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

const asDate = (value) => {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
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
    if (days == null || Number.isNaN(Number(days))) return null;
    const d = new Date(today);
    d.setDate(d.getDate() + Number(days));
    return d;
  }
  return asDate(dateValue);
};

export const toDateInputValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const d = asDate(value);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

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
    amount: Math.round(Number(entry.amount || 0) * 100) / 100,
    resolved_date: resolved ? toDateInputValue(resolved) : null,
  };
};

const sumQuadrant = (entries, quadrant) =>
  Math.round(
    entries.filter((e) => e.quadrant === quadrant).reduce((sum, e) => sum + Number(e.amount || 0), 0) * 100,
  ) / 100;

const entriesUpTo = (entries, quadrant, cutoff) => {
  const cutoffTime = cutoff.getTime();
  return Math.round(
    entries
      .filter((e) => {
        if (e.quadrant !== quadrant) return false;
        const d = asDate(e.resolved_date);
        return d && d.getTime() <= cutoffTime;
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0) * 100,
  ) / 100;
};

const checkpointLabel = (offset) => {
  if (offset === 0) return "Today";
  if (offset === 1) return "1 Day";
  return `${offset} Days`;
};

export const computeQuadrantTotals = (entries) =>
  Object.fromEntries(
    QUADRANTS.map(({ id, title }) => {
      const quadrantEntries = entries.filter((e) => e.quadrant === id);
      return [
        id,
        {
          quadrant: id,
          label: title,
          total_amount: sumQuadrant(entries, id),
          entry_count: quadrantEntries.length,
        },
      ];
    }),
  );

export const computePositions = (entries) => {
  const confirmedIn = sumQuadrant(entries, "confirmed_inflow");
  const confirmedOut = sumQuadrant(entries, "confirmed_outflow");
  const potentialIn = sumQuadrant(entries, "potential_inflow");
  const potentialOut = sumQuadrant(entries, "potential_outflow");
  const confirmedNet = Math.round((confirmedIn - confirmedOut) * 100) / 100;
  const potentialNet = Math.round((potentialIn - potentialOut) * 100) / 100;
  return {
    confirmed_inflows: confirmedIn,
    confirmed_outflows: confirmedOut,
    potential_inflows: potentialIn,
    potential_outflows: potentialOut,
    confirmed_net_position: confirmedNet,
    potential_net_position: potentialNet,
    combined_outlook: Math.round((confirmedNet + potentialNet) * 100) / 100,
  };
};

export const computeCheckpoints = (entries, today = startOfDay(), checkpointDays = DEFAULT_CHECKPOINT_DAYS) =>
  checkpointDays.map((offset) => {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + offset);
    const confirmedIn = entriesUpTo(entries, "confirmed_inflow", cutoff);
    const confirmedOut = entriesUpTo(entries, "confirmed_outflow", cutoff);
    const potentialIn = entriesUpTo(entries, "potential_inflow", cutoff);
    const potentialOut = entriesUpTo(entries, "potential_outflow", cutoff);
    const confirmedNet = Math.round((confirmedIn - confirmedOut) * 100) / 100;
    const potentialNet = Math.round((potentialIn - potentialOut) * 100) / 100;
    const combined = Math.round((confirmedNet + potentialNet) * 100) / 100;
    return {
      horizon: checkpointLabel(offset),
      day_offset: offset,
      cutoff_date: toDateInputValue(cutoff),
      confirmed_inflows: confirmedIn,
      confirmed_outflows: confirmedOut,
      confirmed_net: confirmedNet,
      potential_inflows: potentialIn,
      potential_outflows: potentialOut,
      potential_net: potentialNet,
      combined_position: combined,
      is_negative_confirmed: confirmedNet < 0,
      is_negative_combined: combined < 0,
    };
  });

export const buildTimelinePoints = (entries, today = startOfDay()) => {
  const dated = entries
    .filter((e) => asDate(e.resolved_date))
    .sort((a, b) => {
      const da = asDate(a.resolved_date).getTime();
      const db = asDate(b.resolved_date).getTime();
      if (da !== db) return da - db;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

  let confirmedRunning = 0;
  let combinedRunning = 0;
  const points = dated.map((entry) => {
    const amount = Number(entry.amount || 0);
    const delta = entry.quadrant.endsWith("_inflow") ? amount : -amount;
    if (entry.quadrant.startsWith("confirmed")) {
      confirmedRunning = Math.round((confirmedRunning + delta) * 100) / 100;
    }
    combinedRunning = Math.round((combinedRunning + delta) * 100) / 100;
    return {
      date: entry.resolved_date,
      timestamp: asDate(entry.resolved_date).getTime(),
      label: entry.label,
      quadrant: entry.quadrant,
      amount,
      confirmed_liquidity: confirmedRunning,
      combined_liquidity: combinedRunning,
    };
  });

  if (!points.length) {
    return [
      {
        date: toDateInputValue(today),
        timestamp: today.getTime(),
        label: "Today",
        quadrant: "marker",
        amount: 0,
        confirmed_liquidity: 0,
        combined_liquidity: 0,
      },
    ];
  }
  return points;
};

export const buildCashMatchEvents = (entries) =>
  entries
    .filter((e) => asDate(e.resolved_date))
    .map((entry) => ({
      id: entry.id,
      date: entry.resolved_date,
      timestamp: asDate(entry.resolved_date).getTime(),
      label: entry.label,
      amount: Number(entry.amount || 0),
      quadrant: entry.quadrant,
      quadrant_label: QUADRANT_LABELS[entry.quadrant] || entry.quadrant,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

export const generateLiquiditySummary = (entries, positions, checkpoints, today = startOfDay()) => {
  const lines = [];
  const { confirmed_net_position: confirmedNet, potential_net_position: potentialNet, combined_outlook: combined } =
    positions;
  const todayTime = today.getTime();

  if (confirmedNet >= 0) {
    lines.push(`Confirmed liquidity is positive at ${formatCHF(confirmedNet)} based on scheduled confirmed inflows and outflows.`);
  } else {
    lines.push(`Confirmed liquidity is negative at ${formatCHF(confirmedNet)}; committed outflows exceed confirmed inflows.`);
  }

  const negativeCheckpoints = checkpoints.filter((c) => c.is_negative_combined);
  if (negativeCheckpoints.length) {
    lines.push(
      `The first combined liquidity gap appears by ${negativeCheckpoints[0].horizon.toLowerCase()} (${formatCHF(negativeCheckpoints[0].combined_position)}).`,
    );
  } else {
    lines.push("No combined liquidity gaps are projected across the default horizon checkpoints.");
  }

  if (potentialNet > 0 && confirmedNet < 0 && combined >= 0) {
    lines.push("Forecasted potential inflows appear sufficient to close the confirmed liquidity shortfall in the best-case outlook.");
  } else if (potentialNet > 0 && combined < 0) {
    lines.push("Even if potential inflows materialize, a liquidity shortfall remains in the combined outlook.");
  } else if (potentialNet <= 0 && confirmedNet < 0) {
    lines.push("Potential inflows are not currently expected to offset the confirmed shortfall.");
  }

  const dated = entries.filter((e) => {
    const d = asDate(e.resolved_date);
    return d && d.getTime() >= todayTime;
  });
  const inflows = dated.filter((e) => e.quadrant.endsWith("_inflow"));
  const outflows = dated.filter((e) => e.quadrant.endsWith("_outflow"));
  if (inflows.length) {
    const largestIn = inflows.reduce((best, e) => (Number(e.amount) > Number(best.amount) ? e : best));
    lines.push(`Largest upcoming inflow: ${largestIn.label} (${formatCHF(largestIn.amount)}).`);
  }
  if (outflows.length) {
    const largestOut = outflows.reduce((best, e) => (Number(e.amount) > Number(best.amount) ? e : best));
    lines.push(`Largest upcoming outflow: ${largestOut.label} (${formatCHF(largestOut.amount)}).`);
  }

  const shortTerm = checkpoints.filter((c) => c.day_offset <= 30 && c.is_negative_combined);
  if (shortTerm.length) {
    lines.push("Short-term liquidity risk: combined position turns negative within 30 days.");
    lines.push("Suggested focus: accelerate collections on near-term receivables and review discretionary outflows due this month.");
  } else if (confirmedNet < 0) {
    lines.push("Suggested focus: prioritize confirmed collections and defer non-essential spending until inflows land.");
  } else if (combined < 0) {
    lines.push("Suggested focus: secure additional inflows or financing before larger outflows cluster.");
  } else {
    lines.push("Suggested focus: maintain collection discipline and monitor large outflows approaching within 60–90 days.");
  }

  return lines;
};

export const analyzeCashHorizon = (entries, today = startOfDay(), checkpointDays = DEFAULT_CHECKPOINT_DAYS) => {
  const normalized = entries
    .map((entry) => normalizeEntry(entry, today))
    .sort((a, b) => {
      if (a.quadrant !== b.quadrant) return a.quadrant.localeCompare(b.quadrant);
      if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
      return String(a.resolved_date || "").localeCompare(String(b.resolved_date || ""));
    });
  const positions = computePositions(normalized);
  const checkpoints = computeCheckpoints(normalized, today, checkpointDays);
  return {
    as_of: toDateInputValue(today),
    entries: normalized,
    quadrant_totals: computeQuadrantTotals(normalized),
    positions,
    checkpoints,
    timeline: buildTimelinePoints(normalized, today),
    cash_match_events: buildCashMatchEvents(normalized),
    summary: generateLiquiditySummary(normalized, positions, checkpoints, today),
  };
};

export const buildLiquidityChartDomain = (timeline) => {
  if (!timeline.length) return ["auto", "auto"];
  const timestamps = timeline.map((p) => p.timestamp);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  if (min === max) {
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    return [min - monthMs, max + monthMs];
  }
  return [min, max];
};

export const enrichAnalysisPayload = (payload) => {
  if (!payload) return payload;
  const timeline = (payload.timeline || []).map((point) => ({
    ...point,
    timestamp: point.timestamp ?? (asDate(point.date)?.getTime() ?? null),
  }));
  const cash_match_events = (payload.cash_match_events || []).map((event) => ({
    ...event,
    timestamp: event.timestamp ?? (asDate(event.date)?.getTime() ?? null),
  }));
  return { ...payload, timeline, cash_match_events };
};

export const formatResolvedDisplay = (entry) => {
  if (!entry) return "—";
  if (entry.timing_mode === "days" && entry.days_from_today != null) {
    return `${entry.days_from_today} days`;
  }
  const d = asDate(entry.resolved_date || entry.expected_date);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const quadrantToneClass = (quadrant) => {
  if (quadrant === "confirmed_inflow") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (quadrant === "confirmed_outflow") return "text-rose-400 bg-rose-500/10 border-rose-500/20";
  if (quadrant === "potential_inflow") return "text-sky-400 bg-sky-500/10 border-sky-500/20";
  return "text-amber-400 bg-amber-500/10 border-amber-500/20";
};
