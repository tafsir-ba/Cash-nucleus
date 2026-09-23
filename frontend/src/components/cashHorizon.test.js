import {
  enrichAnalysisPayload,
  formatResolvedDateLabel,
  normalizeEntry,
  parseAmountInput,
  parseOccurrenceCount,
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

  it("resolves distributed timing from fixed start date", () => {
    expect(
      toDateInputValue(
        resolveExpectedDate({
          timingMode: "distributed",
          occurrenceCount: 4,
          expectedDate: "2026-07-08",
          today: TODAY,
        }),
      ),
    ).toBe("2026-10-08");
    // Moving "today" must not change end date when start is fixed
    expect(
      toDateInputValue(
        resolveExpectedDate({
          timingMode: "distributed",
          occurrenceCount: 4,
          expectedDate: "2026-07-08",
          today: new Date(2026, 6, 20),
        }),
      ),
    ).toBe("2026-10-08");
  });

  it("passes through analysis payloads", () => {
    const payload = {
      timeline: [{ date: "2026-08-01", confirmed_liquidity: 1000, combined_liquidity: 1000 }],
      cash_match_events: [{ id: "1", date: "2026-08-01", amount: 1000, quadrant: "confirmed_inflow" }],
    };
    expect(enrichAnalysisPayload(payload)).toBe(payload);
  });

  it("formats resolved date labels and parses amounts safely", () => {
    expect(
      formatResolvedDateLabel({
        resolved_date: "2027-01-04",
        timing_mode: "days",
        days_from_today: 180,
      }),
    ).toBe("4 Jan 2027");
    expect(
      formatResolvedDateLabel({
        timing_mode: "distributed",
        occurrence_count: 4,
        amount: 66000,
        per_occurrence_amount: 16500,
        resolved_date: "2026-10-08",
      }),
    ).toMatch(/4× 17k\/mo/);
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("19000")).toBe(19000);
    expect(parseAmountInput("-1")).toBeNull();
    expect(parseOccurrenceCount("4")).toBe(4);
    expect(parseOccurrenceCount("1")).toBeNull();
  });

  it("preserves empty amount while editing and normalizes distributed entries", () => {
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

    const distributed = normalizeEntry(
      {
        id: "2",
        quadrant: "confirmed_outflow",
        amount: 66000,
        timing_mode: "distributed",
        occurrence_count: 4,
        expected_date: "2026-07-08",
      },
      TODAY,
    );
    expect(distributed.per_occurrence_amount).toBe(16500);
    expect(distributed.expected_date).toBe("2026-07-08");
    expect(distributed.resolved_date).toBe("2026-10-08");
  });
});
