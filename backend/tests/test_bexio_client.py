"""Unit tests for Bexio invoice net aggregation and connection helpers."""
from __future__ import annotations

import asyncio
import os

from bexio_client import (
    CONNECTION_EVAHOMES,
    CONNECTION_EVOHOM,
    get_connection_token,
    infer_connection_from_entity_name,
    resolve_pending_status_ids,
    sum_invoice_net,
)


def test_infer_connection_from_entity_name():
    assert infer_connection_from_entity_name("Evohom SA") == CONNECTION_EVOHOM
    assert infer_connection_from_entity_name("Evahomes SA") == CONNECTION_EVAHOMES
    assert infer_connection_from_entity_name("Family") is None


def test_shared_pat_used_for_both_connections(monkeypatch):
    monkeypatch.setenv("BEXIO_PAT", "shared-token")
    monkeypatch.delenv("BEXIO_PAT_EVOHOM", raising=False)
    monkeypatch.delenv("BEXIO_PAT_EVAHOMES", raising=False)
    assert get_connection_token("evohom") == "shared-token"
    assert get_connection_token("evahomes") == "shared-token"


def test_specific_pat_overrides_shared(monkeypatch):
    monkeypatch.setenv("BEXIO_PAT", "shared-token")
    monkeypatch.setenv("BEXIO_PAT_EVAHOMES", "eva-token")
    assert get_connection_token("evohom") == "shared-token"
    assert get_connection_token("evahomes") == "eva-token"


def test_default_pending_status_ids():
    os.environ.pop("BEXIO_INVOICE_STATUS_IDS", None)
    assert resolve_pending_status_ids() == [8]


def test_sum_invoice_net_with_fx():
    invoices = [
        {"id": 1, "total_net": "100", "currency_id": 1, "kb_item_status_id": 8},
        {"id": 2, "total_net": "50", "currency_id": 3, "kb_item_status_id": 8},
    ]
    total, count = sum_invoice_net(
        invoices,
        already_filtered=True,
        fx_by_currency={1: 1.0, 3: 0.82},
    )
    assert count == 2
    assert total == 141.0


def test_sum_pending_invoice_net_mocked(monkeypatch):
    os.environ.pop("BEXIO_INVOICE_STATUS_IDS", None)

    async def fake_fetch(token, status_ids=None, page_size=500, client=None):
        assert status_ids == [8]
        return [
            {"id": 1, "total_net": "38538.25", "currency_id": 1, "kb_item_status_id": 8},
            {"id": 2, "total_net": "39905", "currency_id": 3, "kb_item_status_id": 8},
        ]

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    async def fake_company(client):
        return 1

    async def fake_fx(client, currency_id, base_currency_id):
        return {1: 1.0, 3: 0.82}[int(currency_id)]

    monkeypatch.setattr("bexio_client.fetch_invoices", fake_fetch)
    monkeypatch.setattr("bexio_client.fetch_company_currency_id", fake_company)
    monkeypatch.setattr("bexio_client.fetch_exchange_factor_to_base", fake_fx)
    monkeypatch.setattr("bexio_client.httpx.AsyncClient", lambda **kwargs: FakeClient())

    from bexio_client import sum_pending_invoice_net

    result = asyncio.run(sum_pending_invoice_net("tok"))
    assert result["amount"] == 71260.35
    assert result["invoice_count"] == 2
    assert result["amount_field"] == "total_net"
    assert result["status_ids"] == [8]
