import {
  evaluateBalanceInput,
  inspectBalanceInput,
  formatBalancePreview,
} from "./amountExpression";

describe("evaluateBalanceInput", () => {
  const current = 100;

  it("treats plain input as the absolute balance value", () => {
    expect(evaluateBalanceInput("-25")).toBe(-25);
    expect(evaluateBalanceInput("-2931.94")).toBe(-2931.94);
    expect(evaluateBalanceInput("100")).toBe(100);
    expect(evaluateBalanceInput("-25", current)).toBe(-25);
  });

  it("evaluates expressions only when prefixed with =", () => {
    expect(evaluateBalanceInput("=100-25")).toBe(75);
    expect(evaluateBalanceInput("=-25")).toBe(-25);
    expect(evaluateBalanceInput("=-25-25")).toBe(-50);
    expect(evaluateBalanceInput("=-25-35", current)).toBe(-60);
    expect(evaluateBalanceInput("=1000*1.077")).toBe(1077);
    expect(evaluateBalanceInput("=(1000+250)-50")).toBe(1200);
  });

  it("does not evaluate bare expressions without =", () => {
    expect(evaluateBalanceInput("100+52")).toBeNull();
    expect(evaluateBalanceInput("500-125")).toBeNull();
  });

  it("does not apply relative adjustments to the previous balance", () => {
    expect(evaluateBalanceInput("+500", current)).toBe(500);
    expect(evaluateBalanceInput("-250", current)).toBe(-250);
    expect(evaluateBalanceInput("*1.05", current)).toBeNull();
    expect(evaluateBalanceInput("/2", current)).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(evaluateBalanceInput("")).toBeNull();
    expect(evaluateBalanceInput("abc")).toBeNull();
    expect(evaluateBalanceInput("=")).toBeNull();
    expect(evaluateBalanceInput("=/0")).toBeNull();
  });
});

describe("inspectBalanceInput", () => {
  it("marks only =-prefixed input as a calculation", () => {
    const calc = inspectBalanceInput("=-25-35", 100);
    expect(calc.isCalculation).toBe(true);
    expect(calc.hasExpression).toBe(true);
    expect(calc.value).toBe(-60);

    const plain = inspectBalanceInput("-25", 100);
    expect(plain.isCalculation).toBe(false);
    expect(plain.hasExpression).toBe(false);
    expect(plain.value).toBe(-25);
  });
});

describe("formatBalancePreview", () => {
  it("shows preview only for =-prefixed calculations", () => {
    expect(formatBalancePreview("-2931.94", 100, (v) => `CHF ${v}`)).toBeNull();
    expect(formatBalancePreview("=-25-35", 100, (v) => `CHF ${v}`)).toBe("=-25-35 → CHF -60");
    expect(formatBalancePreview("=100-25", 0, (v) => String(v))).toBe("=100-25 → 75");
  });
});
