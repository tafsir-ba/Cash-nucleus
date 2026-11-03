import {
  accountSeriesKey,
  buildCashPositionAccountOptions,
  buildCashPositionChartData,
  buildCashPositionChartXDomain,
  buildMultiSeriesCashPositionChartData,
  colorForAccountIndex,
  formatChartDate,
  parseSnapshotDate,
  ACCOUNT_CHART_COLORS,
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

  it("builds multi-series points with per-account keys", () => {
    const days = [
      {
        date: "2026-06-24",
        total_cash_chf: 100,
        accounts: [
          { account_id: "a1", account_name: "UBS", balance_chf: 60 },
          { account_id: "a2", account_name: "Post", balance_chf: 40 },
        ],
      },
      {
        date: "2026-06-25",
        total_cash_chf: 90,
        accounts: [
          { account_id: "a1", account_name: "UBS", balance_chf: 50 },
          { account_id: "a2", account_name: "Post", balance_chf: 40 },
        ],
      },
    ];
    const chartData = buildMultiSeriesCashPositionChartData(days, ["a1", "a2"]);
    expect(chartData).toHaveLength(2);
    expect(chartData[0][accountSeriesKey("a1")]).toBe(60);
    expect(chartData[0][accountSeriesKey("a2")]).toBe(40);
    expect(chartData[1][accountSeriesKey("a1")]).toBe(50);
    expect(chartData[1].total_cash_chf).toBe(90);
  });

  it("uses null for accounts missing on a day", () => {
    const days = [
      {
        date: "2026-06-24",
        total_cash_chf: 60,
        accounts: [{ account_id: "a1", account_name: "UBS", balance_chf: 60 }],
      },
    ];
    const chartData = buildMultiSeriesCashPositionChartData(days, ["a1", "missing"]);
    expect(chartData[0][accountSeriesKey("a1")]).toBe(60);
    expect(chartData[0][accountSeriesKey("missing")]).toBeNull();
  });

  it("prefers live accounts and ignores historical extras when live list exists", () => {
    const options = buildCashPositionAccountOptions(
      [{ id: "live", label: "Live Acc" }],
      [
        {
          accounts: [
            { account_id: "live", account_name: "Live Acc" },
            { account_id: "hist", account_name: "Old Acc" },
          ],
        },
      ],
    );
    expect(options).toEqual([{ id: "live", label: "Live Acc" }]);
  });

  it("falls back to historical account ids when no live accounts exist", () => {
    const options = buildCashPositionAccountOptions(
      [],
      [
        {
          accounts: [
            { account_id: "hist", account_name: "Old Acc", entity: "HoldCo" },
          ],
        },
      ],
    );
    expect(options).toEqual([{ id: "hist", label: "Old Acc" }]);
  });

  it("disambiguates duplicate labels with entity names", () => {
    const options = buildCashPositionAccountOptions(
      [
        { id: "a1", label: "UBS V", entity: "Evohom SA" },
        { id: "a2", label: "UBS V", entity: "Family" },
      ],
      [],
    );
    expect(options).toEqual([
      { id: "a1", label: "UBS V (Evohom SA)" },
      { id: "a2", label: "UBS V (Family)" },
    ]);
  });

  it("cycles account colors from the shared palette", () => {
    expect(colorForAccountIndex(0)).toBe(ACCOUNT_CHART_COLORS[0]);
    expect(colorForAccountIndex(ACCOUNT_CHART_COLORS.length)).toBe(ACCOUNT_CHART_COLORS[0]);
  });
});
