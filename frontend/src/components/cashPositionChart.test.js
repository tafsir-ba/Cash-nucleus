import {
  buildCashPositionChartData,
  buildCashPositionChartXDomain,
  formatChartDate,
  parseSnapshotDate,
} from "./cashPositionChart";

describe("cashPositionChart", () => {
  const sparseDays = [
    { date: "2026-06-24", total_cash_chf: 114955 },
    { date: "2026-06-29", total_cash_chf: 123465 },
    { date: "2026-07-01", total_cash_chf: 119806 },
    { date: "2026-07-06", total_cash_chf: 118161 },
  ];

  it("maps every backend day into chart points", () => {
    const chartData = buildCashPositionChartData(sparseDays);
    expect(chartData).toHaveLength(4);
    expect(chartData.map((point) => point.date)).toEqual([
      "2026-06-24",
      "2026-06-29",
      "2026-07-01",
      "2026-07-06",
    ]);
    expect(chartData.map((point) => point.total_cash_chf)).toEqual([114955, 123465, 119806, 118161]);
  });

  it("sorts chart points chronologically even if input is out of order", () => {
    const chartData = buildCashPositionChartData([
      sparseDays[2],
      sparseDays[0],
      sparseDays[3],
      sparseDays[1],
    ]);
    expect(chartData.map((point) => point.date)).toEqual([
      "2026-06-24",
      "2026-06-29",
      "2026-07-01",
      "2026-07-06",
    ]);
  });

  it("builds an x-domain that spans first and last snapshot timestamps", () => {
    const chartData = buildCashPositionChartData(sparseDays);
    const domain = buildCashPositionChartXDomain(chartData);
    expect(domain).toEqual([
      parseSnapshotDate("2026-06-24"),
      parseSnapshotDate("2026-07-06"),
    ]);
  });

  it("pads the x-domain when only one snapshot exists", () => {
    const chartData = buildCashPositionChartData([{ date: "2026-07-06", total_cash_chf: 118161 }]);
    const [min, max] = buildCashPositionChartXDomain(chartData);
    const dayMs = 24 * 60 * 60 * 1000;
    expect(max - min).toBe(dayMs * 2);
  });

  it("formats chart timestamps back to ISO date labels", () => {
    expect(formatChartDate(parseSnapshotDate("2026-07-06"))).toBe("2026-07-06");
  });

  it("drops invalid snapshot dates instead of breaking the line", () => {
    const chartData = buildCashPositionChartData([
      { date: "2026-06-24", total_cash_chf: 114955 },
      { date: "invalid-date", total_cash_chf: 1 },
      { date: "2026-07-06", total_cash_chf: 118161 },
    ]);
    expect(chartData.map((point) => point.date)).toEqual(["2026-06-24", "2026-07-06"]);
  });
});
