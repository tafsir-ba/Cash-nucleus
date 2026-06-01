"""Flow matching for bulk actual imports (no FastAPI/Mongo dependencies)."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


REVENUE_CATEGORY = "Revenue"


def _flow_category_value(flow: dict) -> str:
    cat = flow.get("category", "Expense")
    if hasattr(cat, "value"):
        return str(cat.value)
    return str(cat or "Expense")


def flow_matches_import_direction(flow: dict, amount: float) -> bool:
    row_is_revenue = amount > 0
    by_category = (_flow_category_value(flow) == REVENUE_CATEGORY) == row_is_revenue
    if flow.get("is_percentage"):
        return by_category
    flow_amount = float(flow.get("amount", 0) or 0)
    if abs(flow_amount) < 1e-9:
        return by_category
    by_amount = (flow_amount > 0) == row_is_revenue
    return by_amount or by_category


def auto_select_flow_match_score(score: float, reason: str) -> bool:
    if score >= 0.55:
        return True
    if score >= 0.45 and reason and "label" in reason:
        return True
    return False


def best_flow_match(
    flows: List[dict],
    description: str,
    amount: float,
    entity_id: Optional[str] = None,
) -> Dict[str, Any]:
    def tokens(text: str) -> set:
        return {t for t in re.split(r"\W+", (text or "").lower()) if len(t) > 2}

    desc_lower = (description or "").lower().strip()
    desc_tokens = tokens(desc_lower)
    amount_abs = abs(amount)
    best: Dict[str, Any] = {"flow_id": None, "score": 0.0, "reason": "No close match"}

    for flow in flows:
        if entity_id and flow.get("entity_id") != entity_id:
            continue
        score = 0.0
        reasons: List[str] = []

        if flow_matches_import_direction(flow, amount):
            score += 0.4
            reasons.append("direction")

        flow_amount = float(flow.get("amount", 0) or 0)
        flow_abs = abs(flow_amount)
        if amount_abs > 0 and flow_abs > 0:
            diff_ratio = abs(flow_abs - amount_abs) / amount_abs
            if diff_ratio <= 0.05:
                score += 0.35
                reasons.append("amount-close")
            elif diff_ratio <= 0.15:
                score += 0.2
                reasons.append("amount-near")

        flow_label = (flow.get("label", "") or "").lower().strip()
        flow_tokens = tokens(flow_label)
        if flow_tokens and desc_tokens:
            overlap = len(flow_tokens.intersection(desc_tokens))
            union = len(flow_tokens.union(desc_tokens))
            jaccard = (overlap / union) if union > 0 else 0
            if jaccard >= 0.6:
                score += 0.35
                reasons.append("label-strong")
            elif jaccard >= 0.35:
                score += 0.22
                reasons.append("label-medium")
            elif overlap > 0:
                score += 0.1
                reasons.append("label-weak")
        elif flow_label:
            if flow_label in desc_lower:
                score += 0.25
                reasons.append("label-substring")
            else:
                label_parts = [p for p in re.split(r"\W+", flow_label) if len(p) > 3]
                if any(p in desc_lower for p in label_parts):
                    score += 0.18
                    reasons.append("label-token")

        if score > best["score"]:
            best = {
                "flow_id": flow.get("id"),
                "score": round(min(score, 0.99), 3),
                "reason": ", ".join(reasons) if reasons else "weak",
            }

    return best
