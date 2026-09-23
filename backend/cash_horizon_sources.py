"""Cash Horizon amount sources — Treasury, Bexio, and future integrations."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

CashHorizonAmountSource = Literal[
    "manual",
    "treasury_account",
    "bexio",
    "treasury_debt",
    "evonucleus_pl",
]

SOURCE_GROUP_ORDER = (
    "treasury_account",
    "bexio",
    "treasury_debt",
    "evonucleus_pl",
)

SOURCE_GROUP_LABELS = {
    "treasury_account": "Treasury accounts",
    "bexio": "Bexio",
    "treasury_debt": "Treasury debts",
    "evonucleus_pl": "Evonucleus",
}


def _round_chf(value: Any) -> float:
    try:
        return round(abs(float(value or 0.0)), 2)
    except (TypeError, ValueError):
        return 0.0


def build_source_catalog(
    *,
    accounts: List[Dict[str, Any]],
    debts: List[Dict[str, Any]],
    bexio_connections: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Build pickable amount sources for inflows and outflows."""
    items: List[Dict[str, Any]] = []

    for account in accounts:
        account_id = account.get("id")
        if not account_id:
            continue
        entity = (account.get("entity") or "").strip()
        label = (account.get("label") or "Account").strip()
        balance_source = account.get("balance_source") or "manual"
        title = f"{entity} · {label}" if entity else label
        subtitle_parts = ["Bank balance"]
        if balance_source == "bexio":
            subtitle_parts.append("Bexio-linked")
        if account.get("is_receivables_financing"):
            subtitle_parts.append("Receivables")
        items.append(
            {
                "id": f"treasury_account:{account_id}",
                "kind": "treasury_account",
                "ref_id": account_id,
                "label": title,
                "subtitle": " · ".join(subtitle_parts),
                "amount": _round_chf(account.get("amount")),
                "enabled": True,
                "suggested_quadrants": [
                    "confirmed_inflow",
                    "confirmed_outflow",
                    "potential_inflow",
                    "potential_outflow",
                ],
                "meta": {
                    "entity": entity,
                    "balance_source": balance_source,
                    "bexio_connection": account.get("bexio_connection"),
                },
            }
        )

    bexio_amount_by_connection: Dict[str, float] = {}
    for account in accounts:
        if (account.get("balance_source") or "manual") != "bexio":
            continue
        cid = account.get("bexio_connection")
        if not cid:
            continue
        # Prefer the latest synced receivables-style balance when multiple accounts share a connection.
        bexio_amount_by_connection[cid] = _round_chf(account.get("amount"))

    for conn in bexio_connections:
        cid = conn.get("id")
        if not cid:
            continue
        configured = bool(conn.get("configured"))
        label = conn.get("label") or cid
        amount = bexio_amount_by_connection.get(cid)
        items.append(
            {
                "id": f"bexio:{cid}",
                "kind": "bexio",
                "ref_id": cid,
                "label": f"{label} · pending invoice net",
                "subtitle": "Live Bexio pending invoices" if configured else "PAT not configured",
                "amount": amount,
                "enabled": configured,
                "disabled_reason": None if configured else "Configure BEXIO_PAT to enable",
                "suggested_quadrants": ["confirmed_inflow", "potential_inflow"],
                "meta": {"connection_id": cid},
            }
        )

    for debt in debts:
        flow_id = debt.get("source_flow_id")
        if not flow_id:
            continue
        creditor = (debt.get("creditor") or "Debt").strip()
        entity = (debt.get("entity") or "").strip()
        title = f"{creditor}" + (f" · {entity}" if entity else "")
        items.append(
            {
                "id": f"treasury_debt:{flow_id}",
                "kind": "treasury_debt",
                "ref_id": flow_id,
                "label": title,
                "subtitle": "Treasury debt total",
                "amount": _round_chf(debt.get("total_debt_chf")),
                "enabled": True,
                "suggested_quadrants": ["confirmed_outflow", "potential_outflow"],
                "meta": {
                    "entity_id": debt.get("entity_id"),
                    "monthly_payment_chf": debt.get("monthly_payment_chf"),
                },
            }
        )

    items.append(
        {
            "id": "evonucleus_pl:default",
            "kind": "evonucleus_pl",
            "ref_id": "default",
            "label": "Evonucleus P&L",
            "subtitle": "Connect later — not available yet",
            "amount": None,
            "enabled": False,
            "disabled_reason": "Evonucleus P&L is not connected yet",
            "suggested_quadrants": [
                "confirmed_inflow",
                "confirmed_outflow",
                "potential_inflow",
                "potential_outflow",
            ],
            "meta": {},
        }
    )

    groups: List[Dict[str, Any]] = []
    for kind in SOURCE_GROUP_ORDER:
        group_items = [item for item in items if item["kind"] == kind]
        if not group_items:
            continue
        groups.append(
            {
                "kind": kind,
                "label": SOURCE_GROUP_LABELS.get(kind, kind),
                "items": group_items,
            }
        )

    return {
        "groups": groups,
        "items": items,
    }


def parse_source_selector(source_id: Optional[str]) -> Optional[Dict[str, str]]:
    """Parse catalog id like 'treasury_account:<uuid>' into kind + ref."""
    if not source_id or source_id == "manual":
        return None
    if ":" not in source_id:
        return None
    kind, _, ref = source_id.partition(":")
    if kind not in SOURCE_GROUP_ORDER or not ref:
        return None
    return {"kind": kind, "ref_id": ref}
