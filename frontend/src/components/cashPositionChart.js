export const parseSnapshotDate = (dateStr) => new Date(`${dateStr}T12:00:00`).getTime();

export const formatChartDate = (timestamp) => {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const TOTAL_SERIES_KEY = "total_cash_chf";
export const TOTAL_SERIES_ID = "__total__";

export const accountSeriesKey = (accountId) => `account_${accountId}`;

/** Stroke colors aligned with the liquidity distribution palette. */
export const ACCOUNT_CHART_COLORS = [
  "#f4f4f5", // zinc-100
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#fb7185", // rose-400
  "#38bdf8", // sky-400
  "#a78bfa", // violet-400
  "#fb923c", // orange-400
  "#2dd4bf", // teal-400
];

export const TOTAL_CHART_COLOR = "#e4e4e7";

export const buildCashPositionChartData = (days) =>
  days
    .map((d) => ({
      date: d.date,
      timestamp: parseSnapshotDate(d.date),
      total_cash_chf: d.total_cash_chf,
    }))
    .filter((point) => Number.isFinite(point.timestamp) && point.total_cash_chf != null)
    .sort((a, b) => a.timestamp - b.timestamp);

/**
 * Build multi-series chart points from history days.
 * Each selected account becomes `account_<id>` on the point; missing balances stay null.
 */
export const buildMultiSeriesCashPositionChartData = (days, selectedAccountIds = []) => {
  const accountIds = [...new Set(selectedAccountIds.filter(Boolean))];
  return days
    .map((d) => {
      const balances = new Map(
        (d.accounts || []).map((a) => [a.account_id, a.balance_chf]),
      );
      const point = {
        date: d.date,
        timestamp: parseSnapshotDate(d.date),
        total_cash_chf: d.total_cash_chf,
      };
      accountIds.forEach((id) => {
        point[accountSeriesKey(id)] = balances.has(id) ? balances.get(id) : null;
      });
      return point;
    })
    .filter((point) => Number.isFinite(point.timestamp) && point.total_cash_chf != null)
    .sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * Stable checkbox options: current treasury accounts first.
 * If no live accounts are provided, fall back to ids discovered in history.
 * When multiple options share the same base label, append entity for disambiguation.
 */
export const buildCashPositionAccountOptions = (accounts = [], days = []) => {
  const options = [];
  const seen = new Set();

  accounts.forEach((acc) => {
    if (!acc?.id || seen.has(acc.id)) return;
    seen.add(acc.id);
    options.push({
      id: acc.id,
      baseLabel: acc.label || acc.account_name || acc.id,
      entity: acc.entity || "",
    });
  });

  // Only discover historical-only accounts when the live list is empty
  // (e.g. history loaded before treasury accounts).
  if (options.length === 0) {
    days.forEach((day) => {
      (day.accounts || day.changed_accounts || []).forEach((a) => {
        const id = a.account_id;
        if (!id || seen.has(id)) return;
        seen.add(id);
        options.push({
          id,
          baseLabel: a.account_name || id,
          entity: a.entity || "",
        });
      });
    });
  }

  const labelCounts = options.reduce((map, opt) => {
    map.set(opt.baseLabel, (map.get(opt.baseLabel) || 0) + 1);
    return map;
  }, new Map());

  return options.map((opt) => ({
    id: opt.id,
    label:
      labelCounts.get(opt.baseLabel) > 1 && opt.entity
        ? `${opt.baseLabel} (${opt.entity})`
        : opt.baseLabel,
  }));
};

export const colorForAccountIndex = (index) =>
  ACCOUNT_CHART_COLORS[((index % ACCOUNT_CHART_COLORS.length) + ACCOUNT_CHART_COLORS.length) % ACCOUNT_CHART_COLORS.length];

export const buildCashPositionChartXDomain = (chartData) => {
  if (!chartData.length) return ["auto", "auto"];
  const timestamps = chartData.map((d) => d.timestamp);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  if (min === max) {
    const dayMs = 24 * 60 * 60 * 1000;
    return [min - dayMs, max + dayMs];
  }
  return [min, max];
};
