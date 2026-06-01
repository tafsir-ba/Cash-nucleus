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
