"""Unit tests for Bexio invoice net aggregation and connection helpers."""
from __future__ import annotations

import os

import pytest

from bexio_client import (
    CONNECTION_EVAHOMES,
    CONNECTION_EVOHOM,
    infer_connection_from_entity_name,
    sum_invoice_net,
)


def test_infer_connection_from_entity_name():
    assert infer_connection_from_entity_name("Evohom SA") == CONNECTION_EVOHOM
    assert infer_connection_from_entity_name("Evahomes SA") == CONNECTION_EVAHOMES
    assert infer_connection_from_entity_name("Family") is None


def test_sum_invoice_net_heuristic_open_only():
    invoices = [
        {"id": 1, "total_net": "100.50", "total_remaining_payments": "100.50"},
        {"id": 2, "total_net": "40.00", "total_remaining_payments": "0"},
        {"id": 3, "total_net": "10.25", "total_remaining_payments": "5.00"},
    ]
    total, count = sum_invoice_net(invoices, status_ids=None)
    assert count == 2
    assert total == 110.75


def test_sum_invoice_net_status_filter_already_filtered():
    invoices = [
        {"id": 1, "total_net": "71.10", "kb_item_status_id": 8},
        {"id": 2, "total_net": "0.25", "kb_item_status_id": 8},
    ]
    total, count = sum_invoice_net(invoices, status_ids=[8], already_filtered=True)
    assert count == 2
    assert total == 71.35


def test_sum_pending_invoice_net_mocked(monkeypatch):
    os.environ.pop("BEXIO_INVOICE_STATUS_IDS", None)

    async def fake_fetch(token, status_ids=None, page_size=500):
        assert token == "tok"
        return [
            {"id": 1, "total_net": "50", "total_remaining_payments": "50"},
            {"id": 2, "total_net": "20", "total_remaining_payments": "0"},
        ]

    monkeypatch.setattr("bexio_client.fetch_invoices", fake_fetch)
    from bexio_client import sum_pending_invoice_net
    import asyncio

    result = asyncio.run(sum_pending_invoice_net("tok"))
    assert result["amount"] == 50.0
    assert result["invoice_count"] == 1
    assert result["amount_field"] == "total_net"
