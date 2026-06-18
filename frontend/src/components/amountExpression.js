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

const RELATIVE_ADJUSTMENT = /^([+\-*\/])(.+)$/;

export const evaluateBalanceInput = (rawInput, currentBalance = null) => {
  const text = String(rawInput ?? "").trim();
  if (!text) return null;

  const relativeMatch = text.match(RELATIVE_ADJUSTMENT);
  if (relativeMatch && currentBalance != null && Number.isFinite(currentBalance)) {
    const [, op, operandExpr] = relativeMatch;
    const operand = evaluateAmountExpression(operandExpr);
    if (operand === null) return null;
    switch (op) {
      case "+":
        return roundToTwo(currentBalance + operand);
      case "-":
        return roundToTwo(currentBalance - operand);
      case "*":
        return roundToTwo(currentBalance * operand);
      case "/":
        return operand === 0 ? null : roundToTwo(currentBalance / operand);
      default:
        return null;
    }
  }

  return evaluateAmountExpression(text);
};

export const inspectBalanceInput = (rawInput, currentBalance = null) => {
  const text = String(rawInput ?? "").trim();
  const isRelative = RELATIVE_ADJUSTMENT.test(text) && currentBalance != null && Number.isFinite(currentBalance);
  const hasExpression = isRelative || HAS_OPERATOR.test(text.replace(/\s+/g, ""));
  const value = evaluateBalanceInput(text, currentBalance);
  return {
    text,
    hasExpression,
    isRelative,
    value,
    isValid: value !== null,
  };
};

export const formatBalancePreview = (rawInput, currentBalance, formatFn) => {
  const inspected = inspectBalanceInput(rawInput, currentBalance);
  if (!inspected.isValid || !inspected.hasExpression) return null;
  const formatted = formatFn ? formatFn(inspected.value) : formatAmountInput(inspected.value);
  if (inspected.isRelative) {
    return `${rawInput.trim()} → ${formatted}`;
  }
  return `${rawInput.trim()} = ${formatted}`;
};
