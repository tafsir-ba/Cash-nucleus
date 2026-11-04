"""Evonucleus P&L bridge — pull AR / ARR metrics for Cash Horizon amount sources.

Cash Horizon (this app) is the consumer. PL evonucleus is the SSOT for open AR,
uninvoiced residual, maintenance ARR, and vendor remaining. Auth uses the PL ops
service key (read-only allowlisted GETs). See docs/evonucleus-bridge.md.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("evonucleus_client")

# Env (cash-nucleus backend):
#   EVONUCLEUS_OPS_API_KEY — same value as PL's OPS_SERVICE_API_KEY
#   EVONUCLEUS_API_BASE   — optional; defaults to the production PL host
EVONUCLEUS_API_BASE_ENV = "EVONUCLEUS_API_BASE"
EVONUCLEUS_OPS_API_KEY_ENV = "EVONUCLEUS_OPS_API_KEY"
DEFAULT_EVONUCLEUS_API_BASE = "https://pl.evonucleus.ch"

DEFAULT_TIMEOUT_S = 20.0

# Stable codes stored on horizon rows and returned as API details.
# Raw upstream bodies are logged only.
CODE_NOT_CONFIGURED = "evonucleus_not_configured"
CODE_UNAVAILABLE = "evonucleus_unavailable"
CODE_UNKNOWN_METRIC = "evonucleus_unknown_metric"
CODE_BAD_PAYLOAD = "evonucleus_bad_payload"
PUBLIC_UNAVAILABLE = "Evonucleus P&L is unavailable"
PUBLIC_NOT_CONFIGURED = "Evonucleus P&L is not configured"


class EvonucleusError(Exception):
    """Raised when the Evonucleus P&L API cannot be reached or returns an error."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        code: str = CODE_UNAVAILABLE,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


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
        "label": "Remaining (to pay)",
        "subtitle": "P&L Vendor tab — signed sum of remaining CHF reporting",
        "path": "/api/vendors/aggregation",
        "field": "_vendor_remaining_sum",
        "suggested_quadrants": ["confirmed_outflow", "potential_outflow"],
    },
)

_METRIC_BY_ID = {m["ref_id"]: m for m in METRIC_DEFS}


def get_api_base() -> str:
    configured = (os.environ.get(EVONUCLEUS_API_BASE_ENV) or "").strip().rstrip("/")
    return configured or DEFAULT_EVONUCLEUS_API_BASE


def get_ops_api_key() -> str:
    return (os.environ.get(EVONUCLEUS_OPS_API_KEY_ENV) or "").strip()


def is_configured() -> bool:
    return bool(get_ops_api_key())


def list_metric_defs() -> List[Dict[str, Any]]:
    """Static metric definitions (no live amounts)."""
    return [dict(m) for m in METRIC_DEFS]


def get_metric_def(ref_id: str) -> Optional[Dict[str, Any]]:
    return _METRIC_BY_ID.get((ref_id or "").strip())


def public_message_for_code(code: Optional[str]) -> str:
    if code == CODE_NOT_CONFIGURED:
        return PUBLIC_NOT_CONFIGURED
    return PUBLIC_UNAVAILABLE


def _signed_chf(value: Any) -> Optional[float]:
    """Round a P&L figure without changing its sign."""
    if value is None or value == "":
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _vendor_remaining_sum(payload: Any) -> float:
    """P&L "Remaining (to pay)": signed sum of remaining_chf_reporting.

    ``GET /api/vendors/aggregation`` returns one row per vendor and no portfolio
    total. The P&L Vendor tab defines that KPI as the sum of
    ``remaining_chf_reporting`` (fallback ``remaining_chf``), with no ``abs``
    and without recomputing cost minus paid. A credit (negative remaining)
    reduces the total. Cash copies that sum and does not redefine it.
    """
    if not isinstance(payload, list):
        raise EvonucleusError(
            "Unexpected vendor aggregation shape",
            code=CODE_BAD_PAYLOAD,
        )
    total = 0.0
    for row in payload:
        if not isinstance(row, dict):
            continue
        remaining = row.get("remaining_chf_reporting")
        if remaining is None:
            remaining = row.get("remaining_chf")
        signed = _signed_chf(remaining)
        if signed is None:
            continue
        total += signed
    return round(total, 2)


def extract_metric_amount(ref_id: str, payloads_by_path: Dict[str, Any]) -> float:
    """Extract one metric amount from already-fetched JSON payloads."""
    meta = get_metric_def(ref_id)
    if not meta:
        raise EvonucleusError(
            f"Unknown Evonucleus metric '{ref_id}'",
            code=CODE_UNKNOWN_METRIC,
        )
    path = meta["path"]
    field = meta["field"]
    payload = payloads_by_path.get(path)
    if payload is None:
        raise EvonucleusError(f"Missing payload for {path}", code=CODE_BAD_PAYLOAD)
    if field == "_vendor_remaining_sum":
        return _vendor_remaining_sum(payload)
    if not isinstance(payload, dict):
        raise EvonucleusError(f"Unexpected payload shape for {path}", code=CODE_BAD_PAYLOAD)
    signed = _signed_chf(payload.get(field))
    if signed is None:
        raise EvonucleusError(f"Missing field {field} on {path}", code=CODE_BAD_PAYLOAD)
    return signed


def _log_upstream(path: str, status_code: int, body: str) -> None:
    logger.warning(
        "evonucleus upstream error code=%s path=%s status=%s body=%s",
        CODE_UNAVAILABLE,
        path,
        status_code,
        (body or "")[:300],
    )


async def _get_json(client: httpx.AsyncClient, path: str) -> Any:
    try:
        resp = await client.get(path)
    except httpx.HTTPError as exc:
        logger.warning("evonucleus request failed code=%s path=%s error=%s", CODE_UNAVAILABLE, path, exc)
        raise EvonucleusError(
            f"Evonucleus request failed: {exc}",
            code=CODE_UNAVAILABLE,
        ) from exc
    if resp.status_code == 401:
        _log_upstream(path, resp.status_code, resp.text or "")
        raise EvonucleusError(
            "Evonucleus authorization failed",
            status_code=401,
            code=CODE_UNAVAILABLE,
        )
    if resp.status_code == 403:
        _log_upstream(path, resp.status_code, resp.text or "")
        raise EvonucleusError(
            "Evonucleus denied the request",
            status_code=403,
            code=CODE_UNAVAILABLE,
        )
    if resp.status_code >= 400:
        _log_upstream(path, resp.status_code, resp.text or resp.reason_phrase or "")
        raise EvonucleusError(
            f"Evonucleus API error {resp.status_code}",
            status_code=resp.status_code,
            code=CODE_UNAVAILABLE,
        )
    if not resp.content:
        return {}
    return resp.json()


async def fetch_payloads(*, paths: Optional[List[str]] = None) -> Dict[str, Any]:
    """GET one or more PL paths in parallel; return {path: json}."""
    if not is_configured():
        raise EvonucleusError(
            "Evonucleus P&L is not configured. Set EVONUCLEUS_OPS_API_KEY (same as PL OPS_SERVICE_API_KEY).",
            code=CODE_NOT_CONFIGURED,
        )
    wanted = list(paths) if paths is not None else sorted({m["path"] for m in METRIC_DEFS})
    headers = {
        "Accept": "application/json",
        "X-Ops-Api-Key": get_ops_api_key(),
    }
    base = get_api_base()

    async with httpx.AsyncClient(
        base_url=base,
        headers=headers,
        timeout=DEFAULT_TIMEOUT_S,
    ) as client:
        async def _one(path: str) -> Tuple[str, Any]:
            return path, await _get_json(client, path)

        pairs = await asyncio.gather(*(_one(path) for path in wanted))
    return {path: payload for path, payload in pairs}


async def fetch_metric_amount(ref_id: str) -> float:
    """Live-resolve a single metric amount from Evonucleus."""
    amounts = await fetch_metric_amounts([ref_id])
    return amounts[ref_id]


async def fetch_metric_amounts(ref_ids: List[str]) -> Dict[str, float]:
    """Resolve several metrics with one parallel fetch of the distinct PL paths."""
    metas: List[Dict[str, Any]] = []
    seen = set()
    for ref_id in ref_ids:
        key = (ref_id or "").strip()
        if key in seen:
            continue
        seen.add(key)
        meta = get_metric_def(key)
        if not meta:
            raise EvonucleusError(
                f"Unknown Evonucleus metric '{key}'",
                code=CODE_UNKNOWN_METRIC,
            )
        metas.append(meta)
    if not metas:
        return {}
    payloads = await fetch_payloads(paths=sorted({m["path"] for m in metas}))
    return {m["ref_id"]: extract_metric_amount(m["ref_id"], payloads) for m in metas}


def _disabled_row(meta: Dict[str, Any], *, code: str) -> Dict[str, Any]:
    return {
        "ref_id": meta["ref_id"],
        "label": meta["label"],
        "subtitle": meta["subtitle"],
        "amount": None,
        "suggested_quadrants": list(meta["suggested_quadrants"]),
        "enabled": False,
        "disabled_reason": public_message_for_code(code),
        "error_code": code,
    }


async def fetch_horizon_metrics() -> List[Dict[str, Any]]:
    """
    Return catalog-ready metric rows with live amounts.

    Each row: ref_id, label, subtitle, amount, suggested_quadrants, enabled, error?
    """
    if not is_configured():
        return [_disabled_row(m, code=CODE_NOT_CONFIGURED) for m in METRIC_DEFS]

    try:
        payloads = await fetch_payloads()
    except EvonucleusError as exc:
        logger.warning("evonucleus catalog fetch failed code=%s detail=%s", exc.code, exc)
        return [_disabled_row(m, code=exc.code or CODE_UNAVAILABLE) for m in METRIC_DEFS]

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
                    "error_code": None,
                }
            )
        except EvonucleusError as exc:
            logger.warning(
                "evonucleus metric extract failed ref=%s code=%s detail=%s",
                m["ref_id"],
                exc.code,
                exc,
            )
            rows.append(_disabled_row(m, code=exc.code or CODE_UNAVAILABLE))
    return rows
