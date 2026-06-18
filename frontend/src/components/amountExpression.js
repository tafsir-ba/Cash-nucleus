const ALLOWED_EXPR = /^[\d+\-*/().,\s]+$/;
const HAS_OPERATOR = /[+\-*/()]/;
const PLAIN_BALANCE = /^[+-]?\d+(?:[.,]\d+)?$/;

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

const parsePlainBalance = (text) => {
  const normalized = text.replace(/,/g, ".").replace(/\s/g, "");
  if (!PLAIN_BALANCE.test(normalized)) return null;
  const value = parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return roundToTwo(value);
};

export const evaluateBalanceInput = (rawInput) => {
  const text = String(rawInput ?? "").trim();
  if (!text) return null;

  if (text.startsWith("=")) {
    const expr = text.slice(1).trim();
    if (!expr) return null;
    return evaluateAmountExpression(expr);
  }

  return parsePlainBalance(text);
};

export const inspectBalanceInput = (rawInput) => {
  const text = String(rawInput ?? "").trim();
  const isCalculation = text.startsWith("=");
  const value = evaluateBalanceInput(text);
  return {
    text,
    hasExpression: isCalculation,
    isCalculation,
    value,
    isValid: value !== null,
  };
};

export const formatBalancePreview = (rawInput, _currentBalance, formatFn) => {
  const text = String(rawInput ?? "").trim();
  if (!text.startsWith("=")) return null;

  const inspected = inspectBalanceInput(rawInput);
  if (!inspected.isValid) return null;

  const formatted = formatFn ? formatFn(inspected.value) : formatAmountInput(inspected.value);
  return `${text} → ${formatted}`;
};
