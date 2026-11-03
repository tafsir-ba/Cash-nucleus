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

/**
 * Single account color palette.
 * `className` paints the liquidity bar; `hex` paints chart strokes.
 * Slot assignment is by fixed account order, never by display rank.
 */
export const ACCOUNT_COLOR_PALETTE = [
  { className: "bg-zinc-100", hex: "#f4f4f5" },
  { className: "bg-emerald-400", hex: "#34d399" },
  { className: "bg-amber-400", hex: "#fbbf24" },
  { className: "bg-rose-400", hex: "#fb7185" },
  { className: "bg-sky-400", hex: "#38bdf8" },
  { className: "bg-violet-400", hex: "#a78bfa" },
  { className: "bg-orange-400", hex: "#fb923c" },
  { className: "bg-teal-400", hex: "#2dd4bf" },
];

export const TOTAL_CHART_COLOR = "#e4e4e7";

/**
 * Fixed color order: unique account ids, sorted, independent of balance
 * and of whichever array order the caller happened to receive.
 */
export const accountsInColorOrder = (accounts = []) => {
  const seen = new Set();
  const unique = [];
  accounts.forEach((account) => {
    if (!account?.id || seen.has(account.id)) return;
    seen.add(account.id);
    unique.push(account);
  });
  unique.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return unique;
};

/** Palette entry for an account. Same id + same account set => same color. */
export const colorForAccountId = (accountId, accounts = []) => {
  if (!accountId) return null;
  const index = accountsInColorOrder(accounts).findIndex((account) => account.id === accountId);
  if (index < 0) return null;
  return ACCOUNT_COLOR_PALETTE[index % ACCOUNT_COLOR_PALETTE.length];
};

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
