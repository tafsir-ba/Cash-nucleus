import {
  buildProjectionChartData,
  buildProjectionChartXDomain,
  formatProjectionMonthTick,
  parseProjectionMonth,
} from "./projectionChart";

const sampleMonths = [
  { month: "2026-05", month_label: "May 2026", closing_cash: 120000 },
  { month: "2026-11", month_label: "Nov 2026", closing_cash: -10000 },
  { month: "2027-03", month_label: "Mar 2027", closing_cash: -200000 },
  { month: "2027-04", month_label: "Apr 2027", closing_cash: -240000 },
  { month: "2027-05", month_label: "May 2027", closing_cash: -264978 },
];

describe("projectionChart", () => {
  it("maps every projection month into chart points", () => {
    const chartData = buildProjectionChartData(sampleMonths);
    expect(chartData).toHaveLength(5);
    expect(chartData.map((point) => point.month)).toEqual([
      "2026-05",
      "2026-11",
      "2027-03",
      "2027-04",
      "2027-05",
    ]);
  });

  it("sorts chart points chronologically even if input is out of order", () => {
    const chartData = buildProjectionChartData([
      sampleMonths[4],
      sampleMonths[1],
      sampleMonths[0],
      sampleMonths[3],
      sampleMonths[2],
    ]);
    expect(chartData.map((point) => point.month)).toEqual([
      "2026-05",
      "2026-11",
      "2027-03",
      "2027-04",
      "2027-05",
    ]);
  });

  it("builds an x-domain that spans first and last month timestamps", () => {
    const chartData = buildProjectionChartData(sampleMonths);
    const domain = buildProjectionChartXDomain(chartData);
    expect(domain).toEqual([
      parseProjectionMonth("2026-05"),
      parseProjectionMonth("2027-05"),
    ]);
  });

  it("formats month ticks consistently", () => {
    expect(formatProjectionMonthTick(parseProjectionMonth("2027-05"))).toBe("May 2027");
  });

  it("drops invalid months instead of breaking the line", () => {
    const chartData = buildProjectionChartData([
      sampleMonths[0],
      { month: "bad-month", month_label: "Bad", closing_cash: 1 },
      sampleMonths[4],
    ]);
    expect(chartData.map((point) => point.month)).toEqual(["2026-05", "2027-05"]);
  });
});
