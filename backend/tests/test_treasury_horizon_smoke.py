"""Smoke coverage for stripped app surface: Treasury + Cash Horizon + auth.

Proves kept modules can create/read/update/delete after projection/bulk UI removal.
Run: cd backend && python3 -m pytest tests/test_treasury_horizon_smoke.py -q
"""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", f"strip_smoke_{uuid.uuid4().hex[:8]}")
os.environ.setdefault("JWT_SECRET", "strip-smoke-secret")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin123")
os.environ["COOKIE_SECURE"] = "false"
os.environ["ENV"] = "test"
os.environ.pop("OPS_SERVICE_API_KEY", None)

import server  # noqa: E402

server.client = AsyncMongoMockClient()
server.db = server.client[os.environ["DB_NAME"]]


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app) as c:
        login = c.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": "admin123"},
        )
        assert login.status_code == 200, login.text
        yield c


MONEY_READS = (
    "/api/bank-accounts",
    "/api/treasury/cash-position-history",
    "/api/treasury/debts",
    "/api/cash-horizon",
    "/api/cash-horizon/sources",
    "/api/cash-flows",
    "/api/cash-flows/with-linked",
    "/api/flow-occurrences",
    "/api/projection",
    "/api/projection/matrix",
    "/api/projection/drivers",
    "/api/projection/scenario-delta",
    "/api/projection/runway",
    "/api/variance-summary",
    "/api/month-details/2026-09",
)


def test_auth_login_me_logout():
    with TestClient(server.app) as fresh:
        login = fresh.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": "admin123"},
        )
        assert login.status_code == 200, login.text
        assert "access_token" in login.cookies or login.json().get("email")

        me = fresh.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json().get("email") == "admin@example.com"

        logout = fresh.post("/api/auth/logout")
        assert logout.status_code == 200
        assert fresh.get("/api/bank-accounts").status_code == 401


def test_anonymous_money_routes_rejected():
    with TestClient(server.app) as anon:
        for path in MONEY_READS:
            resp = anon.get(path)
            assert resp.status_code == 401, f"{path}: {resp.status_code} {resp.text}"
            assert resp.json() == {"detail": "Not authenticated"}
        refresh = anon.post("/api/cash-horizon/refresh-sources")
        assert refresh.status_code == 401, refresh.text
        assert refresh.json() == {"detail": "Not authenticated"}
        created = anon.post(
            "/api/cash-horizon/entries",
            json={
                "quadrant": "confirmed_inflow",
                "label": "Should not land",
                "amount": 1,
                "timing_mode": "days",
                "days_from_today": 1,
                "amount_source": "evonucleus_pl",
                "amount_source_id": "invoiced_open",
            },
        )
        assert created.status_code == 401, created.text
        assert "invoiced" not in created.text.lower()
        assert created.json() == {"detail": "Not authenticated"}


def test_treasury_bank_account_and_debt_crud(client):
    ent = client.post("/api/entities", json={"name": "HoldCo"})
    assert ent.status_code == 200, ent.text
    entity_id = ent.json()["id"]

    create_acc = client.post(
        "/api/bank-accounts",
        json={
            "entity_id": entity_id,
            "label": "Main",
            "amount": 100000,
            "is_receivables_financing": False,
            "trigger": "manual_adjustment",
        },
    )
    assert create_acc.status_code == 200, create_acc.text
    account_id = create_acc.json()["id"]
    assert create_acc.json()["amount"] == 100000
    assert create_acc.json()["entity"] == "HoldCo"

    listed = client.get("/api/bank-accounts")
    assert listed.status_code == 200
    assert any(a["id"] == account_id for a in listed.json())

    updated = client.put(
        f"/api/bank-accounts/{account_id}",
        json={"amount": 95000, "trigger": "manual_adjustment", "note": "spend"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["amount"] == 95000

    history = client.get("/api/treasury/cash-position-history")
    assert history.status_code == 200, history.text
    body = history.json()
    assert "days" in body
    assert "account_audit_log" in body
    assert body["days"], "expected at least one cash position day after account updates"
    latest_day = body["days"][-1]
    assert "accounts" in latest_day
    assert any(a.get("account_id") == account_id for a in latest_day["accounts"])
    assert any(a.get("account_id") == account_id for a in latest_day["changed_accounts"])

    debt = client.post(
        "/api/treasury/debts",
        json={"creditor": "Bank Loan", "total_debt_chf": 250000, "entity_id": entity_id},
    )
    assert debt.status_code == 200, debt.text
    assert debt.json()["category"] in ("Debt", "DEBT") or debt.json().get("category") == "Debt"
    assert debt.json()["label"] == "Bank Loan"
    assert debt.json().get("entity") == "HoldCo"
    flow_id = debt.json()["id"]
    assert float(debt.json()["amount"]) == -250000

    debts = client.get("/api/treasury/debts")
    assert debts.status_code == 200, debts.text
    row = next(d for d in debts.json() if d["source_flow_id"] == flow_id)
    assert row["creditor"] == "Bank Loan"
    assert row["total_debt_chf"] == 250000
    assert row["entity"] == "HoldCo"

    debt_upd = client.put(
        f"/api/treasury/debts/{flow_id}",
        json={"creditor": "Bank Loan Renamed", "total_debt_chf": 200000},
    )
    assert debt_upd.status_code == 200, debt_upd.text
    assert debt_upd.json()["label"] == "Bank Loan Renamed"
    assert float(debt_upd.json()["amount"]) == -200000

    debts2 = client.get("/api/treasury/debts")
    row2 = next(d for d in debts2.json() if d["source_flow_id"] == flow_id)
    assert row2["creditor"] == "Bank Loan Renamed"
    assert row2["total_debt_chf"] == 200000

    deleted = client.delete(f"/api/treasury/debts/{flow_id}")
    assert deleted.status_code == 200, deleted.text
    debts3 = client.get("/api/treasury/debts")
    assert all(d["source_flow_id"] != flow_id for d in debts3.json())

    del_acc = client.delete(f"/api/bank-accounts/{account_id}")
    assert del_acc.status_code == 200, del_acc.text


def test_cash_horizon_entry_crud(client):
    base = client.get("/api/cash-horizon")
    assert base.status_code == 200, base.text
    body = base.json()
    assert "entries" in body
    assert "positions" in body
    assert "checkpoints" in body

    created = client.post(
        "/api/cash-horizon/entries",
        json={
            "quadrant": "confirmed_inflow",
            "label": "Invoice A",
            "amount": 42000,
            "timing_mode": "days",
            "days_from_today": 15,
        },
    )
    assert created.status_code == 200, created.text
    entries = created.json()["entries"]
    assert any(e["label"] == "Invoice A" for e in entries)
    entry_id = next(e["id"] for e in entries if e["label"] == "Invoice A")

    updated = client.put(
        f"/api/cash-horizon/entries/{entry_id}",
        json={"amount": 50000},
    )
    assert updated.status_code == 200, updated.text
    entry = next(e for e in updated.json()["entries"] if e["id"] == entry_id)
    assert float(entry["amount"]) == 50000

    deleted = client.delete(f"/api/cash-horizon/entries/{entry_id}")
    assert deleted.status_code == 200, deleted.text
    assert all(e["id"] != entry_id for e in deleted.json()["entries"])


def test_debt_create_rejects_missing_entity(client):
    res = client.post(
        "/api/treasury/debts",
        json={"creditor": "X", "total_debt_chf": 100, "entity_id": "missing"},
    )
    assert res.status_code == 400


def test_bexio_source_and_sync(client, monkeypatch):
    os.environ["BEXIO_PAT_EVOHOM"] = "test-pat-evohom"
    os.environ["BEXIO_PAT_EVAHOMES"] = "test-pat-evahomes"

    async def fake_fetch(connection_id: str):
        amounts = {"evohom": 71260.35, "evahomes": 7467.0}
        return {
            "amount": amounts[connection_id],
            "invoice_count": 16 if connection_id == "evohom" else 3,
            "status_ids": None,
            "amount_field": "total_net",
            "connection_id": connection_id,
        }

    monkeypatch.setattr(server, "fetch_connection_pending_net", fake_fetch)

    ent = client.post("/api/entities", json={"name": "Evohom SA"})
    assert ent.status_code == 200, ent.text
    entity_id = ent.json()["id"]

    create_acc = client.post(
        "/api/bank-accounts",
        json={
            "entity_id": entity_id,
            "label": "Bexio Acc. Receivables",
            "amount": 0,
            "is_receivables_financing": True,
            "balance_source": "bexio",
            "bexio_connection": "evohom",
        },
    )
    assert create_acc.status_code == 200, create_acc.text
    body = create_acc.json()
    assert body["balance_source"] == "bexio"
    assert body["bexio_connection"] == "evohom"
    assert body["amount"] == 71260.35
    assert body["bexio_invoice_count"] == 16
    account_id = body["id"]

    # Manual amount edit blocked while sourced from Bexio
    blocked = client.put(
        f"/api/bank-accounts/{account_id}",
        json={"amount": 1, "trigger": "manual_adjustment"},
    )
    assert blocked.status_code == 400

    sync = client.post("/api/treasury/sync-bexio")
    assert sync.status_code == 200, sync.text
    assert sync.json()["synced"] == 1
    assert sync.json()["failed"] == 0

    conns = client.get("/api/integrations/bexio/connections")
    assert conns.status_code == 200
    ids = {c["id"] for c in conns.json()}
    assert ids == {"evohom", "evahomes"}


def test_authenticated_money_reads_still_work(client):
    for path in MONEY_READS:
        resp = client.get(path)
        assert resp.status_code == 200, f"{path}: {resp.status_code} {resp.text}"


def test_refresh_shares_pl_fetch_and_hides_upstream_text(client, monkeypatch):
    calls = {"batches": 0}

    async def fake_amounts(ref_ids):
        calls["batches"] += 1
        calls["ids"] = list(ref_ids)
        return {"invoiced_open": 11.0, "arr_potential": 22.0}

    async def fake_one(ref_id):
        return {"invoiced_open": 11.0, "arr_potential": 22.0}[ref_id]

    monkeypatch.setattr(server, "fetch_metric_amounts", fake_amounts)
    monkeypatch.setattr(server, "fetch_metric_amount", fake_one)
    monkeypatch.setenv("EVONUCLEUS_OPS_API_KEY", "test-key-not-secret")

    def _create(ref_id, label):
        resp = client.post(
            "/api/cash-horizon/entries",
            json={
                "quadrant": "confirmed_inflow",
                "label": label,
                "timing_mode": "days",
                "days_from_today": 3,
                "amount_source": "evonucleus_pl",
                "amount_source_id": ref_id,
            },
        )
        assert resp.status_code == 200, resp.text
        return next(e["id"] for e in resp.json()["entries"] if e["label"] == label)

    first = _create("invoiced_open", "PL Invoiced")
    second = _create("arr_potential", "PL ARR")
    refreshed = client.post("/api/cash-horizon/refresh-sources")
    assert refreshed.status_code == 200, refreshed.text
    assert calls["batches"] == 1
    assert set(calls["ids"]) == {"invoiced_open", "arr_potential"}
    by_id = {e["id"]: e for e in refreshed.json()["entries"]}
    assert by_id[first]["amount"] == 11.0
    assert by_id[second]["amount"] == 22.0
    assert by_id[first]["amount_source_error"] is None

    secret = "SECRET_UPSTREAM_BODY_do_not_store"

    async def boom(_ref_ids):
        raise server.EvonucleusError(secret, code="evonucleus_unavailable")

    monkeypatch.setattr(server, "fetch_metric_amounts", boom)
    failed = client.post("/api/cash-horizon/refresh-sources")
    assert failed.status_code == 200, failed.text
    assert secret not in failed.text
    failed_by_id = {e["id"]: e for e in failed.json()["entries"]}
    assert failed_by_id[first]["amount_source_error"] == "evonucleus_unavailable"
    assert failed_by_id[second]["amount_source_error"] == "evonucleus_unavailable"

    client.delete(f"/api/cash-horizon/entries/{first}")
    client.delete(f"/api/cash-horizon/entries/{second}")
