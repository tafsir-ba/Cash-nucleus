export const parseProjectionMonth = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey ?? "");
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return Number.NaN;
  }
  return new Date(year, month - 1, 15).getTime();
};

export const formatProjectionMonthTick = (timestamp) => {
  const d = new Date(timestamp);
  const month = d.toLocaleString("en-US", { month: "short" });
  const year = d.getFullYear();
  return `${month} ${year}`;
};

export const buildProjectionChartData = (months) =>
  months
    .map((month) => ({
      ...month,
      timestamp: parseProjectionMonth(month.month),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && point.closing_cash != null)
    .sort((a, b) => a.timestamp - b.timestamp);

export const buildProjectionChartXDomain = (chartData) => {
  if (!chartData.length) return ["auto", "auto"];
  const timestamps = chartData.map((point) => point.timestamp);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  if (min === max) {
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    return [min - monthMs, max + monthMs];
  }
  return [min, max];
};
