"""Flow matching for bulk actual imports (no FastAPI/Mongo dependencies)."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


REVENUE_CATEGORY = "Revenue"

# Common category suffixes stripped from CSV "Flow match" cells like "Subscriptions - Expense".
_CATEGORY_SUFFIXES = (
    "revenue",
    "expense",
    "cogs",
    "opex",
    "debt",
    "tax",
    "salary",
    "transfer",
    "other",
)


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


def normalize_flow_match_label(raw: Optional[str]) -> str:
    """Normalize a CSV Flow match cell to a comparable cash-flow label."""
    text = (raw or "").strip()
    if not text:
        return ""
    # UI / export often shows "Label - Category"
    for sep in (" - ", " – ", " — "):
        if sep in text:
            left, right = text.rsplit(sep, 1)
            if right.strip().lower() in _CATEGORY_SUFFIXES:
                text = left.strip()
                break
    return text.strip()


def _flow_belongs_to_entity(flow: dict, entity_id: Optional[str]) -> bool:
    """True if flow is in scope. Legacy rows missing entity_id stay eligible."""
    if not entity_id:
        return True
    flow_entity = flow.get("entity_id")
    if flow_entity in (None, ""):
        return True
    return flow_entity == entity_id


def match_flow_by_label(
    flows: List[dict],
    raw_label: Optional[str],
    entity_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve an explicit CSV Flow match / label to a cash flow id."""
    wanted = normalize_flow_match_label(raw_label)
    if not wanted:
        return {"flow_id": None, "score": 0.0, "reason": "No close match"}

    wanted_lower = wanted.lower()
    candidates = [f for f in flows if _flow_belongs_to_entity(f, entity_id)]

    exact = [
        f for f in candidates
        if (f.get("label") or "").strip().lower() == wanted_lower
    ]
    if len(exact) == 1:
        return {"flow_id": exact[0].get("id"), "score": 0.99, "reason": "csv-label-exact"}
    if len(exact) > 1 and entity_id:
        scoped = [f for f in exact if f.get("entity_id") == entity_id]
        if len(scoped) == 1:
            return {"flow_id": scoped[0].get("id"), "score": 0.99, "reason": "csv-label-exact"}
        if scoped:
            return {"flow_id": scoped[0].get("id"), "score": 0.9, "reason": "csv-label-exact-ambiguous"}
    if exact:
        return {"flow_id": exact[0].get("id"), "score": 0.9, "reason": "csv-label-exact-ambiguous"}

    # Prefix / contains against flow labels (still strong enough to auto-select).
    partial = []
    for f in candidates:
        label = (f.get("label") or "").strip().lower()
        if not label:
            continue
        if label in wanted_lower or wanted_lower in label:
            partial.append(f)
    if len(partial) == 1:
        return {"flow_id": partial[0].get("id"), "score": 0.85, "reason": "csv-label-partial"}
    if partial:
        preferred = [f for f in partial if f.get("entity_id") == entity_id] if entity_id else partial
        pick = preferred[0] if preferred else partial[0]
        return {"flow_id": pick.get("id"), "score": 0.72, "reason": "csv-label-partial-ambiguous"}

    return {"flow_id": None, "score": 0.0, "reason": "No close match"}


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
        if not _flow_belongs_to_entity(flow, entity_id):
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
