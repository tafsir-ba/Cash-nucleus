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
    assert all(r["error_code"] == "evonucleus_not_configured" for r in rows)
    assert all(r["disabled_reason"] == "Evonucleus P&L is not configured" for r in rows)


@pytest.mark.asyncio
async def test_vendor_remaining_credit_reduces_total(configured, monkeypatch):
    routes = {
        "/api/vendors/aggregation": [
            {"remaining_chf_reporting": 1000},
            {"remaining_chf_reporting": -400},
        ],
    }
    monkeypatch.setattr(client.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(routes, **kw))
    assert await client.fetch_metric_amount("vendor_remaining") == 600.0


@pytest.mark.asyncio
async def test_fetch_payloads_requests_distinct_paths_together(configured, monkeypatch):
    seen = []

    class _RecordingClient(_FakeAsyncClient):
        async def get(self, path: str):
            seen.append(path)
            return await super().get(path)

    routes = {
        "/api/ar/summary": {"invoiced_amount_chf": 1, "uninvoiced_amount_chf": 2},
        "/api/maintenance/summary": {"annual_recurring_potential": 3},
    }
    monkeypatch.setattr(client.httpx, "AsyncClient", lambda **kw: _RecordingClient(routes, **kw))
    amounts = await client.fetch_metric_amounts(["invoiced_open", "uninvoiced_open", "arr_potential"])
    assert amounts == {"invoiced_open": 1.0, "uninvoiced_open": 2.0, "arr_potential": 3.0}
    assert seen.count("/api/ar/summary") == 1
    assert seen.count("/api/maintenance/summary") == 1
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_upstream_error_is_not_copied_into_catalog(configured, monkeypatch):
    secret = "SECRET_UPSTREAM_VENDOR_BODY"
    routes = {
        "/api/ar/summary": (500, {"detail": secret}),
        "/api/maintenance/summary": (500, {"detail": secret}),
        "/api/vendors/aggregation": (500, {"detail": secret}),
    }
    monkeypatch.setattr(client.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(routes, **kw))
    rows = await client.fetch_horizon_metrics()
    blob = str(rows)
    assert secret not in blob
    assert rows
    assert all(r["enabled"] is False for r in rows)
    assert all(r["error_code"] == "evonucleus_unavailable" for r in rows)
    assert all(r["disabled_reason"] == "Evonucleus P&L is unavailable" for r in rows)
