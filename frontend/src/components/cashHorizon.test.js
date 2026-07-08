import {
  analyzeCashHorizon,
  computeCheckpoints,
  resolveExpectedDate,
  toDateInputValue,
} from "./cashHorizon";

const TODAY = new Date(2026, 6, 8);

describe("cashHorizon", () => {
  it("resolves timing from days and date", () => {
    expect(toDateInputValue(resolveExpectedDate({ timingMode: "days", daysFromToday: 45, today: TODAY }))).toBe(
      "2026-08-22",
    );
    expect(toDateInputValue(resolveExpectedDate({ timingMode: "date", expectedDate: "2026-08-15", today: TODAY }))).toBe(
      "2026-08-15",
    );
  });

  it("computes positions and checkpoints from mixed entries", () => {
    const analysis = analyzeCashHorizon(
      [
        {
          id: "1",
          quadrant: "confirmed_inflow",
          label: "Swissroc Invoice",
          amount: 42000,
          timing_mode: "date",
          expected_date: "2026-08-15",
          sort_order: 0,
        },
        {
          id: "2",
          quadrant: "confirmed_outflow",
          label: "Payroll",
          amount: 38000,
          timing_mode: "date",
          expected_date: "2026-07-31",
          sort_order: 0,
        },
        {
          id: "3",
          quadrant: "potential_inflow",
          label: "Forecast revenue",
          amount: 70000,
          timing_mode: "days",
          days_from_today: 30,
          sort_order: 0,
        },
        {
          id: "4",
          quadrant: "potential_outflow",
          label: "VAT",
          amount: 22000,
          timing_mode: "days",
          days_from_today: 14,
          sort_order: 0,
        },
      ],
      TODAY,
    );

    expect(analysis.positions.confirmed_net_position).toBe(4000);
    expect(analysis.positions.potential_net_position).toBe(48000);
    expect(analysis.positions.combined_outlook).toBe(52000);
    expect(analysis.checkpoints[0].horizon).toBe("Today");
    expect(analysis.summary.length).toBeGreaterThan(2);
  });

  it("marks negative cumulative balances at checkpoints", () => {
    const analysis = analyzeCashHorizon(
      [
        {
          id: "a",
          quadrant: "confirmed_inflow",
          label: "In",
          amount: 50000,
          timing_mode: "days",
          days_from_today: 5,
          sort_order: 0,
        },
        {
          id: "b",
          quadrant: "confirmed_outflow",
          label: "Out",
          amount: 70000,
          timing_mode: "days",
          days_from_today: 5,
          sort_order: 0,
        },
      ],
      TODAY,
    );
    expect(analysis.checkpoints[0].confirmed_net).toBe(0);
    expect(analysis.checkpoints.find((c) => c.day_offset === 7).confirmed_net).toBe(-20000);
  });
});
