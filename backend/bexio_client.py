"""Bexio invoice client — sum pending invoice net amounts for Treasury sync."""
from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx

BEXIO_API_BASE = os.environ.get("BEXIO_API_BASE", "https://api.bexio.com").rstrip("/")
DEFAULT_PAGE_SIZE = 500
MAX_PAGES = 40
# Bexio Pending tab status (confirmed against live Evohom data).
DEFAULT_PENDING_STATUS_IDS = (8,)

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


def resolve_pending_status_ids(explicit: Optional[Sequence[int]] = None) -> List[int]:
    if explicit is not None:
        return [int(x) for x in explicit]
    parsed = _parse_status_ids(os.environ.get("BEXIO_INVOICE_STATUS_IDS"))
    if parsed is not None:
        return parsed
    return list(DEFAULT_PENDING_STATUS_IDS)


def get_connection_token(connection_id: str) -> str:
    """
    Resolve PAT for a named connection from environment.

    Prefer a shared BEXIO_PAT (one token for both Evohom/Evahomes UI slots),
    with optional per-connection overrides when a second company PAT exists.
    """
    key = (connection_id or "").strip().lower()
    shared = (os.environ.get("BEXIO_PAT") or os.environ.get("BEXIO_ACCESS_TOKEN") or "").strip()
    specific = {
        CONNECTION_EVOHOM: os.environ.get("BEXIO_PAT_EVOHOM") or os.environ.get("BEXIO_TOKEN_EVOHOM"),
        CONNECTION_EVAHOMES: os.environ.get("BEXIO_PAT_EVAHOMES") or os.environ.get("BEXIO_TOKEN_EVAHOMES"),
    }.get(key)
    token = ((specific or "").strip() or shared)
    if not token:
        raise BexioError(
            f"No Bexio PAT configured for connection '{key}'. "
            "Set BEXIO_PAT (shared) or BEXIO_PAT_EVOHOM / BEXIO_PAT_EVAHOMES."
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
            "https://developer.bexio.com/pat.",
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
    return _as_float(invoice.get("total_remaining_payments")) > 0.009


async def fetch_company_currency_id(client: httpx.AsyncClient) -> int:
    company = await _get_json(client, "/3.0/company")
    if isinstance(company, dict) and company.get("currency_id") is not None:
        return int(company["currency_id"])
    return 1  # CHF fallback


async def fetch_exchange_factor_to_base(
    client: httpx.AsyncClient,
    currency_id: int,
    base_currency_id: int,
) -> float:
    """Return multiply-factor to convert `currency_id` amounts into company currency."""
    if int(currency_id) == int(base_currency_id):
        return 1.0
    rows = await _get_json(client, f"/3.0/currencies/{currency_id}/exchange_rates")
    if not isinstance(rows, list):
        raise BexioError(f"Unexpected exchange rate payload for currency {currency_id}")
    for row in rows:
        if not isinstance(row, dict):
            continue
        target = row.get("exchange_currency") or {}
        target_id = target.get("id") if isinstance(target, dict) else None
        if target_id is None:
            continue
        if int(target_id) == int(base_currency_id):
            factor = row.get("factor_nr_to_ratio")
            if factor is None:
                factor = row.get("factor_nr")
            return _as_float(factor) or 0.0
    raise BexioError(
        f"No exchange rate from currency {currency_id} to company currency {base_currency_id}"
    )


async def fetch_invoices(
    token: str,
    *,
    status_ids: Optional[Sequence[int]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """Fetch invoices, optionally restricted to status IDs via search."""
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(
            headers=_auth_headers(token),
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    collected: List[Dict[str, Any]] = []
    try:
        assert client is not None
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
    finally:
        if owns_client and client is not None:
            await client.aclose()

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
    fx_by_currency: Optional[Dict[int, float]] = None,
) -> Tuple[float, int]:
    """Sum total_net for open/pending invoices (optionally FX-converted). Returns (sum, count)."""
    total = 0.0
    count = 0
    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        if not already_filtered and not _invoice_is_open(inv, status_ids):
            continue
        amount = _as_float(inv.get("total_net"))
        if fx_by_currency is not None:
            try:
                currency_id = int(inv.get("currency_id") or 0)
            except (TypeError, ValueError):
                currency_id = 0
            amount *= float(fx_by_currency.get(currency_id, 1.0))
        total += amount
        count += 1
    return round(total, 2), count


async def sum_pending_invoice_net(
    token: str,
    *,
    status_ids: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    """
    Pull pending kb_invoice rows and return sum of total_net in company currency.

    Matches the Net total on Bexio Sales → Invoices → Pending (incl. FX conversion).
    """
    resolved_status_ids = resolve_pending_status_ids(status_ids)
    headers = _auth_headers(token)
    timeout = httpx.Timeout(30.0, connect=10.0)

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        base_currency_id = await fetch_company_currency_id(client)
        invoices = await fetch_invoices(
            token,
            status_ids=resolved_status_ids,
            client=client,
        )
        currency_ids = set()
        for inv in invoices:
            try:
                currency_ids.add(int(inv.get("currency_id")))
            except (TypeError, ValueError):
                continue
        fx_by_currency: Dict[int, float] = {}
        for currency_id in currency_ids:
            fx_by_currency[currency_id] = await fetch_exchange_factor_to_base(
                client, currency_id, base_currency_id
            )

    total, count = sum_invoice_net(
        invoices,
        status_ids=resolved_status_ids,
        already_filtered=True,
        fx_by_currency=fx_by_currency,
    )

    return {
        "amount": total,
        "invoice_count": count,
        "status_ids": list(resolved_status_ids),
        "amount_field": "total_net",
        "base_currency_id": base_currency_id,
        "fx_by_currency": {str(k): v for k, v in fx_by_currency.items()},
    }


async def fetch_connection_pending_net(connection_id: str) -> Dict[str, Any]:
    token = get_connection_token(connection_id)
    result = await sum_pending_invoice_net(token)
    result["connection_id"] = connection_id
    return result
