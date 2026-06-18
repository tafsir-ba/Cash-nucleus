import {
  evaluateBalanceInput,
  inspectBalanceInput,
  formatBalancePreview,
} from "./amountExpression";

describe("evaluateBalanceInput", () => {
  const current = 1663;

  it("evaluates absolute expressions", () => {
    expect(evaluateBalanceInput("100+52")).toBe(152);
    expect(evaluateBalanceInput("500-125")).toBe(375);
    expect(evaluateBalanceInput("1000*1.077")).toBe(1077);
    expect(evaluateBalanceInput("1200/4")).toBe(300);
    expect(evaluateBalanceInput("(1000+250)-50")).toBe(1200);
  });

  it("applies relative adjustments from current balance", () => {
    expect(evaluateBalanceInput("+500", current)).toBe(2163);
    expect(evaluateBalanceInput("-250", current)).toBe(1413);
    expect(evaluateBalanceInput("*1.05", current)).toBe(1746.15);
    expect(evaluateBalanceInput("/2", current)).toBe(831.5);
  });

  it("returns null for invalid input", () => {
    expect(evaluateBalanceInput("")).toBeNull();
    expect(evaluateBalanceInput("abc")).toBeNull();
    expect(evaluateBalanceInput("/0", current)).toBeNull();
  });

  it("treats leading-minus as absolute when no current balance is provided", () => {
    expect(evaluateBalanceInput("-250")).toBe(-250);
  });
});

describe("inspectBalanceInput", () => {
  it("detects relative adjustments", () => {
    const result = inspectBalanceInput("+500", 1663);
    expect(result.isRelative).toBe(true);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(2163);
    expect(result.hasExpression).toBe(true);
  });

  it("detects absolute expressions", () => {
    const result = inspectBalanceInput("100+52");
    expect(result.isRelative).toBe(false);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(152);
  });
});

describe("formatBalancePreview", () => {
  it("formats relative preview", () => {
    const preview = formatBalancePreview("+500", 1663, (v) => `CHF ${v}`);
    expect(preview).toBe("+500 → CHF 2163");
  });

  it("formats expression preview", () => {
    const preview = formatBalancePreview("100+52", 0, (v) => String(v));
    expect(preview).toBe("100+52 = 152");
  });
});
