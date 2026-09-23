"""Async bridge tests with mocked PL HTTP responses."""
from __future__ import annotations

import os
from typing import Any, Dict

import httpx
import pytest

import evonucleus_client as client


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else str(payload)
        self.reason_phrase = "OK" if status_code < 400 else "Error"
        self.content = b"{}" if payload is not None else b""

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, routes: Dict[str, Any], **_kwargs):
        self.routes = routes

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, path: str):
        if path not in self.routes:
            return _FakeResponse(404, {"detail": "missing"})
        entry = self.routes[path]
        if isinstance(entry, tuple):
            return _FakeResponse(entry[0], entry[1])
        return _FakeResponse(200, entry)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("EVONUCLEUS_API_BASE", "http://pl.test")
    monkeypatch.setenv("EVONUCLEUS_OPS_API_KEY", "test-ops-key")


@pytest.mark.asyncio
async def test_fetch_horizon_metrics_live(configured, monkeypatch):
    routes = {
        "/api/ar/summary": {
            "invoiced_amount_chf": 68588,
            "uninvoiced_amount_chf": 67577,
            "total_receivables_chf": 136165,
            "overdue_receivables_chf": 1000,
        },
        "/api/maintenance/summary": {
            "monthly_recurring_potential": 486.25,
            "annual_recurring_potential": 5835.0,
        },
        "/api/vendors/aggregation": [
            {"remaining_chf_reporting": 100},
            {"remaining_chf_reporting": 50},
        ],
    }
    monkeypatch.setattr(client.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(routes, **kw))
    rows = await client.fetch_horizon_metrics()
    by_id = {r["ref_id"]: r for r in rows}
    assert by_id["invoiced_open"]["enabled"] is True
    assert by_id["invoiced_open"]["amount"] == 68588.0
    assert by_id["uninvoiced_open"]["amount"] == 67577.0
    assert by_id["arr_potential"]["amount"] == 5835.0
    assert by_id["vendor_remaining"]["amount"] == 150.0


@pytest.mark.asyncio
async def test_fetch_metric_amount(configured, monkeypatch):
    routes = {
        "/api/ar/summary": {"invoiced_amount_chf": 68588, "uninvoiced_amount_chf": 1},
    }
    monkeypatch.setattr(client.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(routes, **kw))
    assert await client.fetch_metric_amount("invoiced_open") == 68588.0


@pytest.mark.asyncio
async def test_unconfigured_returns_disabled_rows(monkeypatch):
    monkeypatch.delenv("EVONUCLEUS_API_BASE", raising=False)
    monkeypatch.delenv("EVONUCLEUS_OPS_API_KEY", raising=False)
    rows = await client.fetch_horizon_metrics()
    assert rows
    assert all(r["enabled"] is False for r in rows)
