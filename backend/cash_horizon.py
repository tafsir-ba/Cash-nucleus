from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

CashHorizonQuadrant = Literal[
    "confirmed_inflow",
    "confirmed_outflow",
    "potential_inflow",
    "potential_outflow",
]

TimingMode = Literal["date", "days"]

DEFAULT_CHECKPOINT_DAYS = [0, 7, 30, 60, 90, 180, 365]

QUADRANT_LABELS = {
    "confirmed_inflow": "Confirmed Inflows",
    "confirmed_outflow": "Confirmed Outflows",
    "potential_inflow": "Potential Inflows",
    "potential_outflow": "Potential Outflows",
}


def _as_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def resolve_expected_date(
    *,
    timing_mode: TimingMode,
    expected_date: Optional[str] = None,
    days_from_today: Optional[int] = None,
    today: Optional[date] = None,
) -> Optional[date]:
    anchor = today or date.today()
    if timing_mode == "days":
        if days_from_today is None:
            return None
        return anchor + timedelta(days=int(days_from_today))
    return _as_date(expected_date)


def normalize_entry(entry: Dict[str, Any], today: Optional[date] = None) -> Dict[str, Any]:
    anchor = today or date.today()
    timing_mode: TimingMode = entry.get("timing_mode") or "date"
    resolved = resolve_expected_date(
        timing_mode=timing_mode,
        expected_date=entry.get("expected_date"),
        days_from_today=entry.get("days_from_today"),
        today=anchor,
    )
    amount = round(float(entry.get("amount") or 0.0), 2)
    return {
        **entry,
        "timing_mode": timing_mode,
        "amount": amount,
        "resolved_date": resolved.isoformat() if resolved else None,
    }


def _quadrant_kind(quadrant: CashHorizonQuadrant) -> Tuple[str, str]:
    if quadrant.endswith("_inflow"):
        return "inflow", "confirmed" if quadrant.startswith("confirmed") else "potential"
    return "outflow", "confirmed" if quadrant.startswith("confirmed") else "potential"


def _sum_entries(entries: List[Dict[str, Any]], quadrant: CashHorizonQuadrant) -> float:
    return round(sum(float(e.get("amount") or 0.0) for e in entries if e.get("quadrant") == quadrant), 2)


def _entries_up_to(
    entries: List[Dict[str, Any]],
    quadrant: CashHorizonQuadrant,
    cutoff: date,
) -> float:
    total = 0.0
    for entry in entries:
        if entry.get("quadrant") != quadrant:
            continue
        resolved = _as_date(entry.get("resolved_date"))
        if resolved is None or resolved > cutoff:
            continue
        total += float(entry.get("amount") or 0.0)
    return round(total, 2)


def _checkpoint_label(day_offset: int) -> str:
    if day_offset == 0:
        return "Today"
    if day_offset == 1:
        return "1 Day"
    return f"{day_offset} Days"


def compute_quadrant_totals(entries: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    totals: Dict[str, Dict[str, Any]] = {}
    for quadrant in QUADRANT_LABELS:
        quadrant_entries = [e for e in entries if e.get("quadrant") == quadrant]
        totals[quadrant] = {
            "quadrant": quadrant,
            "label": QUADRANT_LABELS[quadrant],
            "total_amount": round(sum(float(e.get("amount") or 0.0) for e in quadrant_entries), 2),
            "entry_count": len(quadrant_entries),
        }
    return totals


def compute_positions(entries: List[Dict[str, Any]]) -> Dict[str, float]:
    confirmed_in = _sum_entries(entries, "confirmed_inflow")
    confirmed_out = _sum_entries(entries, "confirmed_outflow")
    potential_in = _sum_entries(entries, "potential_inflow")
    potential_out = _sum_entries(entries, "potential_outflow")
    confirmed_net = round(confirmed_in - confirmed_out, 2)
    potential_net = round(potential_in - potential_out, 2)
    combined = round(confirmed_net + potential_net, 2)
    return {
        "confirmed_inflows": confirmed_in,
        "confirmed_outflows": confirmed_out,
        "potential_inflows": potential_in,
        "potential_outflows": potential_out,
        "confirmed_net_position": confirmed_net,
        "potential_net_position": potential_net,
        "combined_outlook": combined,
    }


def compute_checkpoints(
    entries: List[Dict[str, Any]],
    *,
    today: Optional[date] = None,
    checkpoint_days: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
    anchor = today or date.today()
    days = checkpoint_days or DEFAULT_CHECKPOINT_DAYS
    rows: List[Dict[str, Any]] = []
    for offset in days:
        cutoff = anchor + timedelta(days=offset)
        confirmed_in = _entries_up_to(entries, "confirmed_inflow", cutoff)
        confirmed_out = _entries_up_to(entries, "confirmed_outflow", cutoff)
        potential_in = _entries_up_to(entries, "potential_inflow", cutoff)
        potential_out = _entries_up_to(entries, "potential_outflow", cutoff)
        confirmed_net = round(confirmed_in - confirmed_out, 2)
        potential_net = round(potential_in - potential_out, 2)
        combined = round(confirmed_net + potential_net, 2)
        rows.append(
            {
                "horizon": _checkpoint_label(offset),
                "day_offset": offset,
                "cutoff_date": cutoff.isoformat(),
                "confirmed_inflows": confirmed_in,
                "confirmed_outflows": confirmed_out,
                "confirmed_net": confirmed_net,
                "potential_inflows": potential_in,
                "potential_outflows": potential_out,
                "potential_net": potential_net,
                "combined_position": combined,
                "is_negative_confirmed": confirmed_net < 0,
                "is_negative_combined": combined < 0,
            }
        )
    return rows


def build_timeline_points(entries: List[Dict[str, Any]], today: Optional[date] = None) -> List[Dict[str, Any]]:
    anchor = today or date.today()
    dated = [e for e in entries if _as_date(e.get("resolved_date"))]
    dated.sort(key=lambda e: (_as_date(e.get("resolved_date")), e.get("sort_order", 0), e.get("label", "")))
    points: List[Dict[str, Any]] = []
    confirmed_running = 0.0
    combined_running = 0.0
    for entry in dated:
        resolved = _as_date(entry.get("resolved_date"))
        if resolved is None:
            continue
        amount = float(entry.get("amount") or 0.0)
        quadrant = entry.get("quadrant", "")
        direction = 1 if quadrant.endswith("_inflow") else -1
        delta = direction * amount
        if quadrant.startswith("confirmed"):
            confirmed_running = round(confirmed_running + delta, 2)
        combined_running = round(combined_running + delta, 2)
        points.append(
            {
                "date": resolved.isoformat(),
                "label": entry.get("label", ""),
                "quadrant": quadrant,
                "amount": amount,
                "confirmed_liquidity": confirmed_running,
                "combined_liquidity": combined_running,
            }
        )
    if not points:
        points.append(
            {
                "date": anchor.isoformat(),
                "label": "Today",
                "quadrant": "marker",
                "amount": 0.0,
                "confirmed_liquidity": 0.0,
                "combined_liquidity": 0.0,
            }
        )
    return points


def build_cash_match_events(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for entry in entries:
        resolved = _as_date(entry.get("resolved_date"))
        if resolved is None:
            continue
        events.append(
            {
                "id": entry.get("id"),
                "date": resolved.isoformat(),
                "label": entry.get("label", ""),
                "amount": float(entry.get("amount") or 0.0),
                "quadrant": entry.get("quadrant"),
                "quadrant_label": QUADRANT_LABELS.get(entry.get("quadrant", ""), entry.get("quadrant", "")),
            }
        )
    events.sort(key=lambda e: (e["date"], e.get("label", "")))
    return events


def _format_chf(amount: float) -> str:
    rounded = round(amount)
    prefix = "−" if rounded < 0 else ""
    return f"{prefix}CHF {abs(rounded):,}".replace(",", "'")


def generate_liquidity_summary(
    entries: List[Dict[str, Any]],
    positions: Dict[str, float],
    checkpoints: List[Dict[str, Any]],
) -> List[str]:
    lines: List[str] = []
    confirmed_net = positions["confirmed_net_position"]
    potential_net = positions["potential_net_position"]
    combined = positions["combined_outlook"]

    if confirmed_net >= 0:
        lines.append(f"Confirmed liquidity is positive at {_format_chf(confirmed_net)} based on scheduled confirmed inflows and outflows.")
    else:
        lines.append(f"Confirmed liquidity is negative at {_format_chf(confirmed_net)}; committed outflows exceed confirmed inflows.")

    negative_checkpoints = [c for c in checkpoints if c["is_negative_combined"]]
    if negative_checkpoints:
        first_gap = negative_checkpoints[0]
        lines.append(
            f"The first combined liquidity gap appears by {first_gap['horizon'].lower()} ({_format_chf(first_gap['combined_position'])})."
        )
    else:
        lines.append("No combined liquidity gaps are projected across the default horizon checkpoints.")

    if potential_net > 0 and confirmed_net < 0 and combined >= 0:
        lines.append("Forecasted potential inflows appear sufficient to close the confirmed liquidity shortfall in the best-case outlook.")
    elif potential_net > 0 and combined < 0:
        lines.append("Even if potential inflows materialize, a liquidity shortfall remains in the combined outlook.")
    elif potential_net <= 0 and confirmed_net < 0:
        lines.append("Potential inflows are not currently expected to offset the confirmed shortfall.")

    dated_entries = [e for e in entries if _as_date(e.get("resolved_date"))]
    if dated_entries:
        largest_inflow = max(
            (e for e in dated_entries if str(e.get("quadrant", "")).endswith("_inflow")),
            key=lambda e: float(e.get("amount") or 0.0),
            default=None,
        )
        largest_outflow = max(
            (e for e in dated_entries if str(e.get("quadrant", "")).endswith("_outflow")),
            key=lambda e: float(e.get("amount") or 0.0),
            default=None,
        )
        if largest_inflow:
            lines.append(
                f"Largest upcoming inflow: {largest_inflow.get('label', 'Entry')} ({_format_chf(float(largest_inflow.get('amount') or 0.0))})."
            )
        if largest_outflow:
            lines.append(
                f"Largest upcoming outflow: {largest_outflow.get('label', 'Entry')} ({_format_chf(float(largest_outflow.get('amount') or 0.0))})."
            )

    short_term = [c for c in checkpoints if c["day_offset"] <= 30 and c["is_negative_combined"]]
    if short_term:
        lines.append("Short-term liquidity risk: combined position turns negative within 30 days.")
        lines.append("Suggested focus: accelerate collections on near-term receivables and review discretionary outflows due this month.")
    elif confirmed_net < 0:
        lines.append("Suggested focus: prioritize confirmed collections and defer non-essential spending until inflows land.")
    elif combined < 0:
        lines.append("Suggested focus: secure additional inflows or financing before larger outflows cluster.")
    else:
        lines.append("Suggested focus: maintain collection discipline and monitor large outflows approaching within 60–90 days.")

    return lines


def analyze_cash_horizon(
    entries: List[Dict[str, Any]],
    *,
    today: Optional[date] = None,
    checkpoint_days: Optional[List[int]] = None,
) -> Dict[str, Any]:
    anchor = today or date.today()
    normalized = [normalize_entry(entry, anchor) for entry in entries]
    normalized.sort(
        key=lambda e: (
            e.get("quadrant", ""),
            e.get("sort_order", 0),
            _as_date(e.get("resolved_date")) or anchor,
            e.get("label", ""),
        )
    )
    positions = compute_positions(normalized)
    checkpoints = compute_checkpoints(normalized, today=anchor, checkpoint_days=checkpoint_days)
    return {
        "as_of": anchor.isoformat(),
        "quadrant_totals": compute_quadrant_totals(normalized),
        "positions": positions,
        "checkpoints": checkpoints,
        "timeline": build_timeline_points(normalized, anchor),
        "cash_match_events": build_cash_match_events(normalized),
        "summary": generate_liquidity_summary(normalized, positions, checkpoints),
        "entries": normalized,
    }
