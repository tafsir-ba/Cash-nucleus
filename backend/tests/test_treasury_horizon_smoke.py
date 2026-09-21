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
        yield c


def test_auth_login_me_logout(client):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "password": "admin123"},
    )
    assert login.status_code == 200, login.text
    assert "access_token" in login.cookies or login.json().get("email")

    me = client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    assert me.json().get("email") == "admin@example.com"

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200


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
    assert "days" in history.json()
    assert "account_audit_log" in history.json()

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
