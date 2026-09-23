"""Evonucleus P&L bridge — pull AR / ARR metrics for Cash Horizon amount sources.

Cash Horizon (this app) is the consumer. PL evonucleus is the SSOT for open AR,
uninvoiced residual, and maintenance ARR. Auth uses the PL ops service key
(read-only allowlisted GETs). See docs/evonucleus-bridge.md.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

# Env (cash-nucleus backend):
#   EVONUCLEUS_API_BASE   — e.g. https://pnl.example.com or http://localhost:8000
#   EVONUCLEUS_OPS_API_KEY — same value as PL's OPS_SERVICE_API_KEY
EVONUCLEUS_API_BASE_ENV = "EVONUCLEUS_API_BASE"
EVONUCLEUS_OPS_API_KEY_ENV = "EVONUCLEUS_OPS_API_KEY"

DEFAULT_TIMEOUT_S = 20.0


class EvonucleusError(Exception):
    """Raised when the Evonucleus P&L API cannot be reached or returns an error."""

    def __init__(self, message: str, *, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


# Catalog of bridgeable metrics. Amounts are filled at fetch time.
# ref_id is what Cash Horizon stores in amount_source_id.
METRIC_DEFS: Tuple[Dict[str, Any], ...] = (
    {
        "ref_id": "invoiced_open",
        "label": "Invoiced (Open)",
        "subtitle": "Open AR already invoiced",
        "path": "/api/ar/summary",
        "field": "invoiced_amount_chf",
        "suggested_quadrants": ["confirmed_inflow", "potential_inflow"],
    },
    {
        "ref_id": "uninvoiced_open",
        "label": "Uninvoiced (Open)",
        "subtitle": "Open AR not yet invoiced",
        "path": "/api/ar/summary",
        "field": "uninvoiced_amount_chf",
        "suggested_quadrants": ["potential_inflow", "confirmed_inflow"],
    },
    {
        "ref_id": "total_open_ar",
        "label": "Total open AR",
        "subtitle": "Invoiced + uninvoiced open receivables",
        "path": "/api/ar/summary",
        "field": "total_receivables_chf",
        "suggested_quadrants": ["confirmed_inflow", "potential_inflow"],
    },
    {
        "ref_id": "overdue_ar",
        "label": "Overdue AR",
        "subtitle": "Past-due open receivables",
        "path": "/api/ar/summary",
        "field": "overdue_receivables_chf",
        "suggested_quadrants": ["confirmed_inflow", "potential_inflow"],
    },
    {
        "ref_id": "arr_potential",
        "label": "ARR potential",
        "subtitle": "Maintenance annual recurring potential",
        "path": "/api/maintenance/summary",
        "field": "annual_recurring_potential",
        "suggested_quadrants": ["potential_inflow", "confirmed_inflow"],
    },
    {
        "ref_id": "mrr_potential",
        "label": "MRR potential",
        "subtitle": "Maintenance monthly recurring potential",
        "path": "/api/maintenance/summary",
        "field": "monthly_recurring_potential",
        "suggested_quadrants": ["potential_inflow", "confirmed_inflow"],
    },
    {
        "ref_id": "vendor_remaining",
        "label": "Vendor costs remaining",
        "subtitle": "Sum of vendor remaining (CHF reporting)",
        "path": "/api/vendors/aggregation",
        "field": "_vendor_remaining_sum",
        "suggested_quadrants": ["confirmed_outflow", "potential_outflow"],
    },
)

_METRIC_BY_ID = {m["ref_id"]: m for m in METRIC_DEFS}


def get_api_base() -> str:
    return (os.environ.get(EVONUCLEUS_API_BASE_ENV) or "").strip().rstrip("/")


def get_ops_api_key() -> str:
    return (os.environ.get(EVONUCLEUS_OPS_API_KEY_ENV) or "").strip()


def is_configured() -> bool:
    return bool(get_api_base() and get_ops_api_key())


def list_metric_defs() -> List[Dict[str, Any]]:
    """Static metric definitions (no live amounts)."""
    return [dict(m) for m in METRIC_DEFS]


def get_metric_def(ref_id: str) -> Optional[Dict[str, Any]]:
    return _METRIC_BY_ID.get((ref_id or "").strip())


def _round_chf(value: Any) -> float:
    try:
        return round(abs(float(value or 0.0)), 2)
    except (TypeError, ValueError):
        return 0.0


def _vendor_remaining_sum(payload: Any) -> float:
    if not isinstance(payload, list):
        return 0.0
    total = 0.0
    for row in payload:
        if not isinstance(row, dict):
            continue
        remaining = row.get("remaining_chf_reporting")
        if remaining is None:
            remaining = row.get("remaining_chf")
        total += _round_chf(remaining)
    return round(total, 2)


def extract_metric_amount(ref_id: str, payloads_by_path: Dict[str, Any]) -> float:
    """Extract one metric amount from already-fetched JSON payloads."""
    meta = get_metric_def(ref_id)
    if not meta:
        raise EvonucleusError(f"Unknown Evonucleus metric '{ref_id}'")
    path = meta["path"]
    field = meta["field"]
    payload = payloads_by_path.get(path)
    if payload is None:
        raise EvonucleusError(f"Missing payload for {path}")
    if field == "_vendor_remaining_sum":
        return _vendor_remaining_sum(payload)
    if not isinstance(payload, dict):
        raise EvonucleusError(f"Unexpected payload shape for {path}")
    return _round_chf(payload.get(field))


async def _get_json(client: httpx.AsyncClient, path: str) -> Any:
    try:
        resp = await client.get(path)
    except httpx.HTTPError as exc:
        raise EvonucleusError(f"Evonucleus request failed: {exc}") from exc
    if resp.status_code == 401:
        raise EvonucleusError(
            "Evonucleus authorization failed (401). Check EVONUCLEUS_OPS_API_KEY.",
            status_code=401,
        )
    if resp.status_code == 403:
        raise EvonucleusError(
            f"Evonucleus denied {path} (403). Ensure the path is ops-allowlisted on PL.",
            status_code=403,
        )
    if resp.status_code >= 400:
        detail = (resp.text or resp.reason_phrase or "")[:300]
        raise EvonucleusError(
            f"Evonucleus API error {resp.status_code}: {detail}",
            status_code=resp.status_code,
        )
    if not resp.content:
        return {}
    return resp.json()


async def fetch_payloads(*, paths: Optional[List[str]] = None) -> Dict[str, Any]:
    """GET one or more PL paths; return {path: json}."""
    if not is_configured():
        raise EvonucleusError(
            "Evonucleus P&L is not configured. Set EVONUCLEUS_API_BASE and EVONUCLEUS_OPS_API_KEY."
        )
    wanted = paths or sorted({m["path"] for m in METRIC_DEFS})
    headers = {
        "Accept": "application/json",
        "X-Ops-Api-Key": get_ops_api_key(),
    }
    base = get_api_base()
    out: Dict[str, Any] = {}
    async with httpx.AsyncClient(
        base_url=base,
        headers=headers,
        timeout=DEFAULT_TIMEOUT_S,
    ) as client:
        for path in wanted:
            out[path] = await _get_json(client, path)
    return out


async def fetch_metric_amount(ref_id: str) -> float:
    """Live-resolve a single metric amount from Evonucleus."""
    meta = get_metric_def(ref_id)
    if not meta:
        raise EvonucleusError(f"Unknown Evonucleus metric '{ref_id}'")
    payloads = await fetch_payloads(paths=[meta["path"]])
    return extract_metric_amount(ref_id, payloads)


async def fetch_horizon_metrics() -> List[Dict[str, Any]]:
    """
    Return catalog-ready metric rows with live amounts.

    Each row: ref_id, label, subtitle, amount, suggested_quadrants, enabled, error?
    """
    if not is_configured():
        return [
            {
                "ref_id": m["ref_id"],
                "label": m["label"],
                "subtitle": m["subtitle"],
                "amount": None,
                "suggested_quadrants": list(m["suggested_quadrants"]),
                "enabled": False,
                "disabled_reason": "Set EVONUCLEUS_API_BASE and EVONUCLEUS_OPS_API_KEY",
            }
            for m in METRIC_DEFS
        ]

    try:
        payloads = await fetch_payloads()
    except EvonucleusError as exc:
        reason = str(exc)
        return [
            {
                "ref_id": m["ref_id"],
                "label": m["label"],
                "subtitle": m["subtitle"],
                "amount": None,
                "suggested_quadrants": list(m["suggested_quadrants"]),
                "enabled": False,
                "disabled_reason": reason,
            }
            for m in METRIC_DEFS
        ]

    rows: List[Dict[str, Any]] = []
    for m in METRIC_DEFS:
        try:
            amount = extract_metric_amount(m["ref_id"], payloads)
            rows.append(
                {
                    "ref_id": m["ref_id"],
                    "label": m["label"],
                    "subtitle": m["subtitle"],
                    "amount": amount,
                    "suggested_quadrants": list(m["suggested_quadrants"]),
                    "enabled": True,
                    "disabled_reason": None,
                }
            )
        except EvonucleusError as exc:
            rows.append(
                {
                    "ref_id": m["ref_id"],
                    "label": m["label"],
                    "subtitle": m["subtitle"],
                    "amount": None,
                    "suggested_quadrants": list(m["suggested_quadrants"]),
                    "enabled": False,
                    "disabled_reason": str(exc),
                }
            )
    return rows
