"""
Bulk actual import backend tests (auth, integrity, and apply path).
"""
import io
import os
import uuid
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


@pytest.fixture
def auth_session():
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
    return session


@pytest.fixture
def test_entity(auth_session):
    name = f"TEST_BulkImport_{uuid.uuid4().hex[:8]}"
    resp = auth_session.post(f"{BASE_URL}/api/entities", json={"name": name}, timeout=20)
    assert resp.status_code == 200
    entity = resp.json()
    yield entity

    # Cleanup flows then entity
    flows_resp = auth_session.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}, timeout=20)
    if flows_resp.status_code == 200:
        for flow in flows_resp.json():
            auth_session.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true", timeout=20)
    auth_session.delete(f"{BASE_URL}/api/entities/{entity['id']}", timeout=20)


def test_bulk_import_parse_requires_auth(test_entity):
    # Use plain requests (no auth cookie) - should be blocked.
    csv_bytes = b"date,description,amount\n2026-05-14,NoAuth Expense,-1200\n"
    files = {"file": ("statement.csv", io.BytesIO(csv_bytes), "text/csv")}
    resp = requests.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert resp.status_code == 401


def test_bulk_import_apply_records_occurrence_and_enforces_entity_scope(auth_session, test_entity):
    # Create two entities/flows to verify entity enforcement.
    flow_ok_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Bulk Expense OK",
            "amount": -1200,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_ok_resp.status_code == 200
    flow_ok = flow_ok_resp.json()

    other_entity_resp = auth_session.post(
        f"{BASE_URL}/api/entities",
        json={"name": f"TEST_OtherEntity_{uuid.uuid4().hex[:8]}"},
        timeout=20,
    )
    assert other_entity_resp.status_code == 200
    other_entity = other_entity_resp.json()

    flow_other_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Bulk Expense OTHER",
            "amount": -900,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": other_entity["id"],
        },
        timeout=20,
    )
    assert flow_other_resp.status_code == 200
    flow_other = flow_other_resp.json()

    # Parse import batch for first entity.
    csv_bytes = b"date,description,amount\n2026-05-14,Vendor Payment,-1200\n"
    files = {"file": ("statement.csv", io.BytesIO(csv_bytes), "text/csv")}
    parse_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert parse_resp.status_code == 200, parse_resp.text
    payload = parse_resp.json()
    batch_id = payload["batch"]["id"]
    row = payload["rows"][0]

    # Try selecting a flow from another entity -> must fail.
    invalid_update = auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row['id']}",
        json={"selected_flow_id": flow_other["id"], "include": True},
        timeout=20,
    )
    assert invalid_update.status_code == 400
    assert "entity scope" in invalid_update.text.lower()

    # Set valid flow and apply.
    valid_update = auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row['id']}",
        json={"selected_flow_id": flow_ok["id"], "include": True, "month": "2026-05"},
        timeout=20,
    )
    assert valid_update.status_code == 200, valid_update.text

    apply_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch_id}/apply",
        json={},
        timeout=30,
    )
    assert apply_resp.status_code == 200, apply_resp.text
    apply_data = apply_resp.json()
    assert apply_data["status"] in {"applied", "partial", "idempotent"}
    assert apply_data.get("applied_rows", 0) >= 1 or apply_data["status"] == "idempotent"

    occ_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences",
        params={"flow_id": flow_ok["id"], "month": "2026-05"},
        timeout=20,
    )
    assert occ_resp.status_code == 200
    occs = occ_resp.json()
    assert len(occs) >= 1
    assert round(float(occs[0]["actual_amount"]), 2) == -1200.0

    # Cleanup secondary entity and flow.
    auth_session.delete(f"{BASE_URL}/api/cash-flows/{flow_other['id']}?delete_linked=true", timeout=20)
    auth_session.delete(f"{BASE_URL}/api/entities/{other_entity['id']}", timeout=20)
