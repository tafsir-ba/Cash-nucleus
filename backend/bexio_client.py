"""Bexio invoice client — sum pending invoice net amounts for Treasury sync."""
from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx

BEXIO_API_BASE = os.environ.get("BEXIO_API_BASE", "https://api.bexio.com").rstrip("/")
DEFAULT_PAGE_SIZE = 500
MAX_PAGES = 40

# Connection keys used by Treasury accounts (Evohom SA / Evahomes SA).
CONNECTION_EVOHOM = "evohom"
CONNECTION_EVAHOMES = "evahomes"
KNOWN_CONNECTIONS = (CONNECTION_EVOHOM, CONNECTION_EVAHOMES)


class BexioError(Exception):
    """Raised when Bexio API access or aggregation fails."""

    def __init__(self, message: str, *, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def _parse_status_ids(raw: Optional[str]) -> Optional[List[int]]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    out: List[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        out.append(int(part))
    return out or None


def get_connection_token(connection_id: str) -> str:
    """Resolve PAT for a named connection from environment."""
    key = (connection_id or "").strip().lower()
    specific = {
        CONNECTION_EVOHOM: os.environ.get("BEXIO_PAT_EVOHOM") or os.environ.get("BEXIO_TOKEN_EVOHOM"),
        CONNECTION_EVAHOMES: os.environ.get("BEXIO_PAT_EVAHOMES") or os.environ.get("BEXIO_TOKEN_EVAHOMES"),
    }.get(key)
    shared = os.environ.get("BEXIO_PAT") or os.environ.get("BEXIO_ACCESS_TOKEN")
    token = (specific or shared or "").strip()
    if not token:
        raise BexioError(
            f"No Bexio PAT configured for connection '{key}'. "
            f"Set BEXIO_PAT_{key.upper()} or BEXIO_PAT in the backend environment."
        )
    return token


def infer_connection_from_entity_name(entity_name: str) -> Optional[str]:
    name = (entity_name or "").strip().lower()
    if not name:
        return None
    if "evahomes" in name or "eva homes" in name:
        return CONNECTION_EVAHOMES
    if "evohom" in name:
        return CONNECTION_EVOHOM
    return None


def list_configured_connections() -> List[Dict[str, Any]]:
    """Return connection metadata without exposing secrets."""
    rows = []
    for cid in KNOWN_CONNECTIONS:
        try:
            token = get_connection_token(cid)
            configured = bool(token)
        except BexioError:
            configured = False
        rows.append(
            {
                "id": cid,
                "label": "Evohom SA" if cid == CONNECTION_EVOHOM else "Evahomes SA",
                "configured": configured,
            }
        )
    return rows


def _auth_headers(token: str) -> Dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }


async def _get_json(
    client: httpx.AsyncClient,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
) -> Any:
    url = f"{BEXIO_API_BASE}{path}"
    try:
        resp = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise BexioError(f"Bexio request failed: {exc}") from exc
    if resp.status_code == 401:
        raise BexioError(
            "Bexio authorization failed (401). Use a Personal Access Token from "
            "https://developer.bexio.com/pat (Client ID/Secret alone is not a PAT).",
            status_code=401,
        )
    if resp.status_code >= 400:
        detail = resp.text[:300] if resp.text else resp.reason_phrase
        raise BexioError(f"Bexio API error {resp.status_code}: {detail}", status_code=resp.status_code)
    if not resp.content:
        return []
    return resp.json()


async def _post_json(
    client: httpx.AsyncClient,
    path: str,
    body: Any,
    *,
    params: Optional[Dict[str, Any]] = None,
) -> Any:
    url = f"{BEXIO_API_BASE}{path}"
    try:
        resp = await client.post(url, params=params, json=body)
    except httpx.HTTPError as exc:
        raise BexioError(f"Bexio request failed: {exc}") from exc
    if resp.status_code == 401:
        raise BexioError(
            "Bexio authorization failed (401). Use a Personal Access Token from "
            "https://developer.bexio.com/pat.",
            status_code=401,
        )
    if resp.status_code >= 400:
        detail = resp.text[:300] if resp.text else resp.reason_phrase
        raise BexioError(f"Bexio API error {resp.status_code}: {detail}", status_code=resp.status_code)
    if not resp.content:
        return []
    return resp.json()


def _as_float(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _invoice_is_open(invoice: Dict[str, Any], status_ids: Optional[Sequence[int]]) -> bool:
    if status_ids is not None:
        try:
            return int(invoice.get("kb_item_status_id")) in set(status_ids)
        except (TypeError, ValueError):
            return False
    # Heuristic matching Bexio "open" receivables: unpaid residual remains.
    return _as_float(invoice.get("total_remaining_payments")) > 0.009


async def fetch_invoices(
    token: str,
    *,
    status_ids: Optional[Sequence[int]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> List[Dict[str, Any]]:
    """Fetch invoices, optionally restricted to status IDs via search."""
    headers = _auth_headers(token)
    timeout = httpx.Timeout(30.0, connect=10.0)
    collected: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        if status_ids:
            for status_id in status_ids:
                offset = 0
                for _ in range(MAX_PAGES):
                    batch = await _post_json(
                        client,
                        "/2.0/kb_invoice/search",
                        [{"field": "kb_item_status_id", "value": str(status_id), "criteria": "="}],
                        params={"limit": page_size, "offset": offset, "order_by": "id"},
                    )
                    if not isinstance(batch, list) or not batch:
                        break
                    collected.extend(batch)
                    if len(batch) < page_size:
                        break
                    offset += page_size
        else:
            offset = 0
            for _ in range(MAX_PAGES):
                batch = await _get_json(
                    client,
                    "/2.0/kb_invoice",
                    params={"limit": page_size, "offset": offset, "order_by": "id"},
                )
                if not isinstance(batch, list) or not batch:
                    break
                collected.extend(batch)
                if len(batch) < page_size:
                    break
                offset += page_size

    # Deduplicate by invoice id (status search can overlap).
    by_id: Dict[Any, Dict[str, Any]] = {}
    for inv in collected:
        if isinstance(inv, dict) and "id" in inv:
            by_id[inv["id"]] = inv
    return list(by_id.values())


def sum_invoice_net(
    invoices: Iterable[Dict[str, Any]],
    *,
    status_ids: Optional[Sequence[int]] = None,
    already_filtered: bool = False,
) -> Tuple[float, int]:
    """Sum total_net for open/pending invoices. Returns (sum, count)."""
    total = 0.0
    count = 0
    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        if not already_filtered and not _invoice_is_open(inv, status_ids):
            continue
        total += _as_float(inv.get("total_net"))
        count += 1
    return round(total, 2), count


async def sum_pending_invoice_net(
    token: str,
    *,
    status_ids: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    """
    Pull kb_invoice list and return sum of total_net for pending/open invoices.

    Matches the Net total on Bexio Sales → Invoices → Pending (open receivables).
    """
    resolved_status_ids = status_ids
    if resolved_status_ids is None:
        resolved_status_ids = _parse_status_ids(os.environ.get("BEXIO_INVOICE_STATUS_IDS"))

    invoices = await fetch_invoices(token, status_ids=resolved_status_ids)
    total, count = sum_invoice_net(
        invoices,
        status_ids=resolved_status_ids,
        already_filtered=resolved_status_ids is not None,
    )

    return {
        "amount": total,
        "invoice_count": count,
        "status_ids": list(resolved_status_ids) if resolved_status_ids else None,
        "amount_field": "total_net",
    }


async def fetch_connection_pending_net(connection_id: str) -> Dict[str, Any]:
    token = get_connection_token(connection_id)
    result = await sum_pending_invoice_net(token)
    result["connection_id"] = connection_id
    return result
