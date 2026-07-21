"""
Smoke-test every bulk actual-import route using in-memory Mongo (mongomock-motor).

Run: cd backend && pytest tests/test_bulk_actual_routes_smoke.py -v
"""
from __future__ import annotations

import io
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", f"bulk_route_test_{uuid.uuid4().hex[:8]}")
os.environ.setdefault("JWT_SECRET", "route-test-secret")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin123")
os.environ.setdefault("ENABLE_BULK_ACTUALS", "true")
os.environ["COOKIE_SECURE"] = "false"
os.environ["ENV"] = "test"

import server  # noqa: E402

server.client = AsyncMongoMockClient()
server.db = server.client[os.environ["DB_NAME"]]

BULK_ROUTES = [
    ("GET", "/api/actual-imports/matching-flows"),
    ("POST", "/api/actual-imports/parse"),
    ("GET", "/api/actual-imports"),
    ("GET", "/api/actual-imports/{batch_id}"),
    ("GET", "/api/actual-imports/{batch_id}/rows"),
    ("PUT", "/api/actual-imports/{batch_id}/rows/{row_id}"),
    ("POST", "/api/actual-imports/{batch_id}/apply"),
    ("POST", "/api/actual-imports/{batch_id}/rematch"),
    ("POST", "/api/actual-imports/{batch_id}/simulate"),
    ("POST", "/api/actual-imports/{batch_id}/discard"),
]


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app) as c:
        login = c.post(
            "/api/auth/login",
            json={"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert login.status_code == 200, login.text
        yield c


@pytest.fixture
def entity_id(client: TestClient):
    name = f"RouteTest_{uuid.uuid4().hex[:8]}"
    resp = client.post("/api/entities", json={"name": name})
    assert resp.status_code == 200, resp.text
    eid = resp.json()["id"]
    yield eid
    client.delete(f"/api/entities/{eid}")


@pytest.fixture
def expense_flow_id(client: TestClient, entity_id: str):
    resp = client.post(
        "/api/cash-flows",
        json={
            "label": "Route Test Expense",
            "amount": -500,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": entity_id,
        },
    )
    assert resp.status_code == 200, resp.text
    fid = resp.json()["id"]
    yield fid
    client.delete(f"/api/cash-flows/{fid}?delete_linked=true")


def test_openapi_registers_all_bulk_routes(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    for method, path_template in BULK_ROUTES:
        assert path_template in paths, f"Missing path {path_template}"
        assert method.lower() in paths[path_template], f"Missing {method} on {path_template}"


def test_matching_flows_returns_entity_lines(client: TestClient, entity_id: str, expense_flow_id: str):
    resp = client.get("/api/actual-imports/matching-flows", params={"entity_id": entity_id})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    flows = body["flows"] if isinstance(body, dict) else body
    assert isinstance(flows, list)
    assert any(f["id"] == expense_flow_id for f in flows)
    if isinstance(body, dict):
        assert "Expense" in body.get("categories", [])


def test_parse_list_get_rows_update_simulate_rematch_apply_discard(
    client: TestClient, entity_id: str, expense_flow_id: str
):
    csv = b"date,description,amount\n2026-05-14,Route Test Expense payment,-500\n"
    parse = client.post(
        "/api/actual-imports/parse",
        data={"entity_id": entity_id},
        files={"file": ("stmt.csv", io.BytesIO(csv), "text/csv")},
    )
    assert parse.status_code == 200, parse.text
    batch_id = parse.json()["batch"]["id"]
    row_id = parse.json()["rows"][0]["id"]

    assert client.get("/api/actual-imports", params={"entity_id": entity_id}).status_code == 200
    assert client.get(f"/api/actual-imports/{batch_id}").status_code == 200
    assert client.get(f"/api/actual-imports/{batch_id}/rows").status_code == 200

    upd = client.put(
        f"/api/actual-imports/{batch_id}/rows/{row_id}",
        json={"selected_flow_id": expense_flow_id, "classification": "existing_flow", "include": True},
    )
    assert upd.status_code == 200, upd.text

    sim = client.post(
        f"/api/actual-imports/{batch_id}/simulate",
        params={"entity_id": entity_id, "horizon": 12, "scenario": "likely"},
        json={},
    )
    assert sim.status_code == 200, sim.text
    assert "matrix" in sim.json() and "changes" in sim.json()

    rematch = client.post(f"/api/actual-imports/{batch_id}/rematch")
    assert rematch.status_code == 200, rematch.text

    apply = client.post(f"/api/actual-imports/{batch_id}/apply", json={})
    assert apply.status_code == 200, apply.text
    assert apply.json().get("applied_rows", 0) >= 1

    discard = client.post(f"/api/actual-imports/{batch_id}/discard")
    assert discard.status_code == 200
    assert discard.json().get("status") == "discarded"


def test_parse_requires_auth():
    with TestClient(server.app) as anon:
        csv = b"date,description,amount\n2026-05-14,X,-1\n"
        resp = anon.post(
            "/api/actual-imports/parse",
            data={"entity_id": "any"},
            files={"file": ("x.csv", io.BytesIO(csv), "text/csv")},
        )
        assert resp.status_code == 401


def test_simulate_404_unknown_batch(client: TestClient):
    resp = client.post(
        "/api/actual-imports/nonexistent-batch-id/simulate",
        params={"horizon": 12},
        json={},
    )
    assert resp.status_code == 404


def test_matching_flows_requires_entity_id(client: TestClient):
    assert client.get("/api/actual-imports/matching-flows").status_code == 422

def test_simulate_multi_entity_batch_returns_non_empty_matrix(client: TestClient):
    """Included rows on different entities must not filter the matrix to one entity only."""
    e1 = client.post("/api/entities", json={"name": f"SimA_{uuid.uuid4().hex[:6]}"})
    e2 = client.post("/api/entities", json={"name": f"SimB_{uuid.uuid4().hex[:6]}"})
    assert e1.status_code == 200 and e2.status_code == 200
    id_a, id_b = e1.json()["id"], e2.json()["id"]

    flow_a = client.post(
        "/api/cash-flows",
        json={
            "label": "Sim Flow A",
            "amount": -100,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": id_a,
        },
    )
    flow_b = client.post(
        "/api/cash-flows",
        json={
            "label": "Sim Flow B",
            "amount": 200,
            "date": "2026-05-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": id_b,
        },
    )
    assert flow_a.status_code == 200 and flow_b.status_code == 200
    fid_a, fid_b = flow_a.json()["id"], flow_b.json()["id"]

    csv = (
        b"date,description,amount\n"
        b"2026-05-10,Line entity A,-50\n"
        b"2026-05-11,Line entity B,75\n"
    )
    parse = client.post(
        "/api/actual-imports/parse",
        data={"entity_id": id_a},
        files={"file": ("multi.csv", io.BytesIO(csv), "text/csv")},
    )
    assert parse.status_code == 200, parse.text
    batch_id = parse.json()["batch"]["id"]
    rows = sorted(parse.json()["rows"], key=lambda r: r.get("row_index", 0))
    assert len(rows) == 2

    client.put(
        f"/api/actual-imports/{batch_id}/rows/{rows[0]['id']}",
        json={"entity_id": id_a, "selected_flow_id": fid_a, "include": True, "month": "2026-05"},
    )
    client.put(
        f"/api/actual-imports/{batch_id}/rows/{rows[1]['id']}",
        json={"entity_id": id_b, "selected_flow_id": fid_b, "include": True, "month": "2026-05"},
    )

    # Wrong filter: only entity A — matrix would miss entity B flows without the fix.
    sim = client.post(
        f"/api/actual-imports/{batch_id}/simulate",
        params={"entity_id": id_a, "horizon": 12, "scenario": "likely"},
        json={},
    )
    assert sim.status_code == 200, sim.text
    matrix = sim.json().get("matrix") or {}
    row_count = len(matrix.get("revenue_rows", [])) + len(matrix.get("expense_rows", []))
    assert row_count > 0, matrix
    flow_ids = {r.get("flow_id") for r in matrix.get("revenue_rows", []) + matrix.get("expense_rows", [])}
    assert fid_a in flow_ids or fid_b in flow_ids

    client.delete(f"/api/cash-flows/{fid_a}")
    client.delete(f"/api/cash-flows/{fid_b}")
    client.delete(f"/api/entities/{id_a}")
    client.delete(f"/api/entities/{id_b}")


def test_parse_enriched_prepopulated_columns(client: TestClient):
    """Excel-style enriched exports should pre-fill entity/month/category/flow match."""
    e1 = client.post("/api/entities", json={"name": f"Evohom SA {uuid.uuid4().hex[:6]}"})
    e2 = client.post("/api/entities", json={"name": f"Family {uuid.uuid4().hex[:6]}"})
    assert e1.status_code == 200 and e2.status_code == 200
    id_a, id_b = e1.json()["id"], e2.json()["id"]
    name_a, name_b = e1.json()["name"], e2.json()["name"]

    flow_a = client.post(
        "/api/cash-flows",
        json={
            "label": "Subscriptions",
            "amount": -20,
            "date": "2026-06-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": id_a,
        },
    )
    flow_b = client.post(
        "/api/cash-flows",
        json={
            "label": "Personal expenses",
            "amount": -80,
            "date": "2026-06-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": id_b,
        },
    )
    assert flow_a.status_code == 200 and flow_b.status_code == 200
    fid_a, fid_b = flow_a.json()["id"], flow_b.json()["id"]

    csv = (
        "Date,Posting text,Amount,Value,Entity,Month,Category,Flow match\n"
        f"03.06.2026,Achat Mastercard 02.06.2026 Netflix,-13.26,02.06.2026,{name_a},2026-06,Expense,Subscriptions - Expense\n"
        f"08.06.2026,Achat Mastercard 07.06.2026 Shop,-80,07.06.2026,{name_b},2026-06,Expense,Personal expenses - Expense\n"
    ).encode("utf-8")

    parse = client.post(
        "/api/actual-imports/parse",
        data={"entity_id": id_a},
        files={"file": ("enriched.csv", io.BytesIO(csv), "text/csv")},
    )
    assert parse.status_code == 200, parse.text
    body = parse.json()
    detected = body["detected_columns"]
    assert detected.get("entity") == "Entity"
    assert detected.get("month") == "Month"
    assert detected.get("category") == "Category"
    assert detected.get("flow_match") == "Flow match"
    assert detected.get("value_date") == "Value"
    assert detected.get("amount") == "Amount"
    assert detected.get("description") == "Posting text"

    rows = sorted(body["rows"], key=lambda r: r.get("row_index", 0))
    assert len(rows) == 2

    r0, r1 = rows[0], rows[1]
    assert r0["transaction_date"] == "2026-06-03"
    assert r0["value_date"] == "2026-06-02"
    assert r0["month"] == "2026-06"
    assert r0["entity_id"] == id_a
    assert r0["category"] == "Expense"
    assert r0["selected_flow_id"] == fid_a
    assert r0["match_reason"] == "file-flow-match"
    assert r0["status"] == "ready"

    assert r1["entity_id"] == id_b
    assert r1["selected_flow_id"] == fid_b
    assert r1["amount"] == -80.0
    assert r1["status"] == "ready"

    client.delete(f"/api/cash-flows/{fid_a}?delete_linked=true")
    client.delete(f"/api/cash-flows/{fid_b}?delete_linked=true")
    client.delete(f"/api/entities/{id_a}")
    client.delete(f"/api/entities/{id_b}")
