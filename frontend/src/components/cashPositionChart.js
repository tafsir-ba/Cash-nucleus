export const parseSnapshotDate = (dateStr) => new Date(`${dateStr}T12:00:00`).getTime();

export const formatChartDate = (timestamp) => {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
