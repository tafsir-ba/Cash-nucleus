import {
  buildMatchChartDomain,
  buildMatchScatterData,
  enrichAnalysisPayload,
  formatResolvedDateLabel,
  normalizeEntry,
  parseAmountInput,
  patchEntryForDisplay,
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

  it("enriches API payloads missing chart timestamps", () => {
    const enriched = enrichAnalysisPayload({
      timeline: [{ date: "2026-08-01", confirmed_liquidity: 1000, combined_liquidity: 1000 }],
      cash_match_events: [{ id: "1", date: "2026-08-01", amount: 1000, quadrant: "confirmed_inflow" }],
    });
    expect(enriched.timeline[0].timestamp).toBeGreaterThan(0);
    expect(enriched.cash_match_events[0].timestamp).toBeGreaterThan(0);
  });

  it("formats resolved date labels and parses amounts safely", () => {
    expect(
      formatResolvedDateLabel({
        resolved_date: "2027-01-04",
        timing_mode: "days",
        days_from_today: 180,
      }),
    ).toBe("4 Jan 2027");
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("19000")).toBe(19000);
    expect(parseAmountInput("-1")).toBeNull();
  });

  it("preserves empty amount while editing", () => {
    const normalized = normalizeEntry(
      { id: "1", quadrant: "confirmed_inflow", amount: "", timing_mode: "date", expected_date: "2026-08-01" },
      TODAY,
    );
    expect(normalized.amount).toBe("");
    const patched = patchEntryForDisplay(
      [{ id: "1", quadrant: "confirmed_inflow", amount: 1000, timing_mode: "date", expected_date: "2026-08-01" }],
      "1",
      { amount: "" },
      TODAY,
    );
    expect(patched[0].amount).toBe("");
  });

  it("builds scatter points and chart domain for cash match timeline", () => {
    const events = [
      {
        id: "1",
        date: "2026-07-31",
        timestamp: Date.UTC(2026, 6, 31, 12),
        amount: 38000,
        quadrant: "confirmed_outflow",
        label: "Payroll",
      },
      {
        id: "2",
        date: "2026-08-15",
        timestamp: Date.UTC(2026, 7, 15, 12),
        amount: 42000,
        quadrant: "confirmed_inflow",
        label: "Invoice",
      },
    ];
    const scatter = buildMatchScatterData(events);
    expect(scatter).toHaveLength(2);
    expect(scatter[0].y).toBe(-38000);
    expect(scatter[1].y).toBe(42000);
    const domain = buildMatchChartDomain(events, []);
    expect(domain[0]).toBeLessThan(domain[1]);
  });
});
