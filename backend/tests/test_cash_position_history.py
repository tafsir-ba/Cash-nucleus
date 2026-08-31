"""Cash position history endpoint should not 500 on mixed/legacy snapshot docs."""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", f"cash_history_test_{uuid.uuid4().hex[:8]}")
os.environ.setdefault("JWT_SECRET", "history-test-secret")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin123")
os.environ["COOKIE_SECURE"] = "false"
os.environ["ENV"] = "test"

import server  # noqa: E402

server.client = AsyncMongoMockClient()
server.db = server.client[os.environ["DB_NAME"]]


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app) as c:
        yield c


async def reset_history(snapshots=None, audit=None):
    await server.db.cash_balance_snapshots.delete_many({})
    await server.db.bank_account_audit_log.delete_many({})
    if snapshots:
        await server.db.cash_balance_snapshots.insert_many(snapshots)
    if audit:
        await server.db.bank_account_audit_log.insert_many(audit)


def test_history_empty(client: TestClient):
    asyncio.run(reset_history())
    resp = client.get("/api/treasury/cash-position-history")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["days"] == []
    assert body["account_audit_log"] == []


def test_history_returns_latest_snapshot_per_day(client: TestClient):
    now = datetime.now(timezone.utc).isoformat()
    asyncio.run(
        reset_history(
            [
                {
                    "id": str(uuid.uuid4()),
                    "snapshot_type": "daily_cash_position",
                    "date": "2026-08-30",
                    "total_cash_chf": 100000,
                    "accounts": [
                        {
                            "account_id": "acc-1",
                            "account_name": "UBS",
                            "entity_id": "ent-1",
                            "entity": "Evohom SA",
                            "balance_chf": 100000,
                            "movement_chf": 0,
                        }
                    ],
                    "created_at": now,
                    "created_by": "tester",
                    "trigger": "manual_adjustment",
                },
                {
                    "id": str(uuid.uuid4()),
                    "snapshot_type": "daily_cash_position",
                    "date": "2026-08-31",
                    "total_cash_chf": 112304,
                    "accounts": [
                        {
                            "account_id": "acc-1",
                            "account_name": "UBS",
                            "entity_id": "ent-1",
                            "entity": "Evohom SA",
                            "balance_chf": 112304,
                            "movement_chf": 12304,
                        }
                    ],
                    "created_at": now,
                    "created_by": "tester",
                    "trigger": "manual_adjustment",
                },
            ]
        )
    )

    resp = client.get("/api/treasury/cash-position-history")
    assert resp.status_code == 200, resp.text
    days = resp.json()["days"]
    assert [d["date"] for d in days] == ["2026-08-30", "2026-08-31"]
    assert days[0]["movement_chf"] is None
    assert days[1]["total_cash_chf"] == 112304
    assert days[1]["movement_chf"] == 12304


def test_history_skips_dirty_docs_instead_of_500(client: TestClient):
    now = datetime.now(timezone.utc).isoformat()
    asyncio.run(
        reset_history(
            [
                {
                    "id": str(uuid.uuid4()),
                    "snapshot_type": "daily_cash_position",
                    "date": datetime(2026, 8, 30, tzinfo=timezone.utc),
                    "accounts": [
                        {
                            "account_id": "acc-1",
                            "account_name": "UBS",
                            "entity": "Evohom SA",
                            "balance_chf": "51000",
                        }
                    ],
                    "created_at": datetime(2026, 8, 30, 10, 0, tzinfo=timezone.utc),
                    "created_by": None,
                    "trigger": "not-a-real-trigger",
                },
                {
                    "id": str(uuid.uuid4()),
                    "snapshot_type": "daily_cash_position",
                    "date": "2026-08-31",
                    "accounts": "not-a-list",
                    "created_at": now,
                    "trigger": "import",
                },
            ],
            [
                {
                    "id": str(uuid.uuid4()),
                    "account_id": "acc-1",
                    "previous_balance_chf": 50000,
                    "new_balance_chf": 51000,
                    "delta_chf": 1000,
                    "changed_at": datetime(2026, 8, 30, 10, 0, tzinfo=timezone.utc),
                    "changed_by": "tester",
                    "trigger": "bogus",
                },
                {
                    "id": str(uuid.uuid4()),
                    "previous_balance_chf": 1,
                },
            ],
        )
    )

    resp = client.get("/api/treasury/cash-position-history")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [d["date"] for d in body["days"]] == ["2026-08-30", "2026-08-31"]
    assert body["days"][0]["trigger"] == "system_recalc"
    assert body["days"][0]["total_cash_chf"] == 51000
    assert body["days"][1]["total_cash_chf"] == 0
    assert len(body["account_audit_log"]) == 1
    assert body["account_audit_log"][0]["trigger"] == "system_recalc"
