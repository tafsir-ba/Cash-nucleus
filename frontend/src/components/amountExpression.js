const ALLOWED_EXPR = /^[\d+\-*/().,\s]+$/;
const HAS_OPERATOR = /[+\-*/()]/;

const roundToTwo = (value) => Math.round(value * 100) / 100;

export const formatAmountInput = (value) => Number(roundToTwo(value).toFixed(2)).toString();

export const evaluateAmountExpression = (rawInput) => {
  const text = String(rawInput ?? "").trim();
  if (!text) return null;

  const normalized = text.replace(/,/g, ".");
  if (!ALLOWED_EXPR.test(normalized)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${normalized});`)();
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return roundToTwo(value);
  } catch {
    return null;
  }
};

export const inspectAmountInput = (rawInput) => {
  const text = String(rawInput ?? "").trim();
  const hasExpression = HAS_OPERATOR.test(text.replace(/\s+/g, ""));
  const value = evaluateAmountExpression(text);
  return {
    text,
    hasExpression,
    value,
    isValid: value !== null,
  };
};
