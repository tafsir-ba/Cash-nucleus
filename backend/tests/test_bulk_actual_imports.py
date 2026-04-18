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


def test_bulk_import_apply_addition_merges_with_existing_actual(auth_session, test_entity):
    """Addition mode sums the import row onto the stored actual; override replaces it."""
    flow_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Bulk Addition Merge",
            "amount": -1000,
            "date": "2026-06-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_resp.status_code == 200
    flow = flow_resp.json()

    csv_first = b"date,description,amount\n2026-06-10,First line,-500\n"
    files = {"file": ("statement.csv", io.BytesIO(csv_first), "text/csv")}
    parse1 = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert parse1.status_code == 200, parse1.text
    batch1 = parse1.json()["batch"]["id"]
    row1 = parse1.json()["rows"][0]
    auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch1}/rows/{row1['id']}",
        json={"selected_flow_id": flow["id"], "include": True, "month": "2026-06"},
        timeout=20,
    )
    apply1 = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch1}/apply",
        json={},
        timeout=30,
    )
    assert apply1.status_code == 200, apply1.text

    occ_mid = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences",
        params={"flow_id": flow["id"], "month": "2026-06"},
        timeout=20,
    )
    assert occ_mid.status_code == 200
    assert round(float(occ_mid.json()[0]["actual_amount"]), 2) == -500.0

    csv_second = b"date,description,amount\n2026-06-12,Second line,-200\n"
    files2 = {"file": ("statement2.csv", io.BytesIO(csv_second), "text/csv")}
    parse2 = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files2,
        timeout=20,
    )
    assert parse2.status_code == 200, parse2.text
    batch2 = parse2.json()["batch"]["id"]
    row2 = parse2.json()["rows"][0]
    auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch2}/rows/{row2['id']}",
        json={
            "selected_flow_id": flow["id"],
            "include": True,
            "month": "2026-06",
            "actual_merge_mode": "addition",
        },
        timeout=20,
    )
    apply2 = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch2}/apply",
        json={},
        timeout=30,
    )
    assert apply2.status_code == 200, apply2.text
    assert apply2.json().get("applied_rows", 0) >= 1

    occ_final = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences",
        params={"flow_id": flow["id"], "month": "2026-06"},
        timeout=20,
    )
    assert occ_final.status_code == 200
    assert round(float(occ_final.json()[0]["actual_amount"]), 2) == -700.0


def test_bulk_import_within_batch_replace_then_addition_running_sum(auth_session, test_entity):
    """Within a single batch, a Replace row followed by an Add-to-current row on the
    same flow+month must produce a running sum: second row adds on top of the first.

    Mirrors the real-world case of two Swisscom expense lines on the same statement:
    row 1 (-110.25, Replace) writes -110.25, then row 2 (-101.85, Add to current)
    must read the just-written -110.25 and land on -212.10.
    """
    flow_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Bulk Swisscom Running Sum",
            "amount": -200,
            "date": "2026-04-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_resp.status_code == 200
    flow = flow_resp.json()

    csv_bytes = (
        b"date,description,amount\n"
        b"2026-04-05,Ordre de paiement Swisscom,-110.25\n"
        b"2026-04-18,Ordre de paiement Swisscom,-101.85\n"
    )
    files = {"file": ("swisscom.csv", io.BytesIO(csv_bytes), "text/csv")}
    parse_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert parse_resp.status_code == 200, parse_resp.text
    batch_id = parse_resp.json()["batch"]["id"]
    rows = parse_resp.json()["rows"]
    assert len(rows) == 2

    # Parser may not preserve CSV order in its response; sort by row_index so the
    # first row really is the -110.25 Replace line.
    rows_sorted = sorted(rows, key=lambda r: r.get("row_index", 0))
    row_first, row_second = rows_sorted[0], rows_sorted[1]

    # Row 1: Replace with -110.25
    upd1 = auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row_first['id']}",
        json={
            "selected_flow_id": flow["id"],
            "include": True,
            "month": "2026-04",
            "actual_merge_mode": "override",
        },
        timeout=20,
    )
    assert upd1.status_code == 200, upd1.text

    # Row 2: Add to current with -101.85
    upd2 = auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row_second['id']}",
        json={
            "selected_flow_id": flow["id"],
            "include": True,
            "month": "2026-04",
            "actual_merge_mode": "addition",
        },
        timeout=20,
    )
    assert upd2.status_code == 200, upd2.text

    apply_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch_id}/apply",
        json={},
        timeout=30,
    )
    assert apply_resp.status_code == 200, apply_resp.text
    apply_data = apply_resp.json()
    assert apply_data.get("applied_rows", 0) == 2, apply_data

    occ_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences",
        params={"flow_id": flow["id"], "month": "2026-04"},
        timeout=20,
    )
    assert occ_resp.status_code == 200
    occs = occ_resp.json()
    assert len(occs) == 1
    assert round(float(occs[0]["actual_amount"]), 2) == -212.10


def test_bulk_import_emits_cell_history_events(auth_session, test_entity):
    """After a bulk apply, GET /flow-occurrences/{id}/history?month= returns one
    event per applied row, with accurate before/after amounts, merge modes, and
    the batch filename so a user can trace what the upload actually wrote."""
    flow_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Bulk History Trace",
            "amount": -300,
            "date": "2026-08-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_resp.status_code == 200
    flow = flow_resp.json()

    csv_bytes = (
        b"date,description,amount\n"
        b"2026-08-05,Swisscom bill part 1,-110.25\n"
        b"2026-08-20,Swisscom bill part 2,-101.85\n"
    )
    files = {"file": ("swisscom_trace.csv", io.BytesIO(csv_bytes), "text/csv")}
    parse_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert parse_resp.status_code == 200, parse_resp.text
    batch_id = parse_resp.json()["batch"]["id"]
    rows_sorted = sorted(parse_resp.json()["rows"], key=lambda r: r.get("row_index", 0))
    row_first, row_second = rows_sorted[0], rows_sorted[1]

    auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row_first['id']}",
        json={
            "selected_flow_id": flow["id"], "include": True,
            "month": "2026-08", "actual_merge_mode": "override",
        },
        timeout=20,
    )
    auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row_second['id']}",
        json={
            "selected_flow_id": flow["id"], "include": True,
            "month": "2026-08", "actual_merge_mode": "addition",
        },
        timeout=20,
    )

    apply_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch_id}/apply",
        json={},
        timeout=30,
    )
    assert apply_resp.status_code == 200, apply_resp.text
    assert apply_resp.json().get("applied_rows", 0) == 2

    history_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences/{flow['id']}/history",
        params={"month": "2026-08", "limit": 50},
        timeout=20,
    )
    assert history_resp.status_code == 200, history_resp.text
    events = history_resp.json()
    assert isinstance(events, list)
    # Two apply events for this cell (newest first).
    bulk_events = [e for e in events if e.get("source") == "bulk_import" and e.get("batch_id") == batch_id]
    assert len(bulk_events) == 2, bulk_events

    # Oldest-first ordering for easier per-row assertions.
    bulk_events_asc = sorted(bulk_events, key=lambda e: e["timestamp"])
    e1, e2 = bulk_events_asc

    # Row 1 (Replace -110.25): previous None (fresh cell), new -110.25.
    assert e1["merge_mode"] == "override"
    assert round(float(e1["input_amount"]), 2) == -110.25
    assert e1["previous_actual_amount"] in (None, 0, 0.0)
    assert round(float(e1["new_actual_amount"]), 2) == -110.25
    assert e1["batch_filename"] == "swisscom_trace.csv"
    assert e1["batch_row_id"] == row_first["id"]

    # Row 2 (Add to current -101.85): previous must be -110.25 from row 1, new -212.10.
    assert e2["merge_mode"] == "addition"
    assert round(float(e2["input_amount"]), 2) == -101.85
    assert round(float(e2["previous_actual_amount"]), 2) == -110.25
    assert round(float(e2["new_actual_amount"]), 2) == -212.10
    assert e2["batch_row_id"] == row_second["id"]

    # History is returned newest-first by default.
    assert events[0]["timestamp"] >= events[-1]["timestamp"]

    # Month filter must scope to the queried cell: other months for the same flow
    # should not leak in.
    other_month_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences/{flow['id']}/history",
        params={"month": "2026-09"},
        timeout=20,
    )
    assert other_month_resp.status_code == 200
    assert other_month_resp.json() == []


def test_manual_actual_edit_emits_history_event(auth_session, test_entity):
    """PUT /flow-occurrences must leave a manual/set event in the cell history
    so manual corrections after a bulk upload are traceable alongside the
    imported rows."""
    flow_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Manual Audit",
            "amount": -500,
            "date": "2026-09-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_resp.status_code == 200
    flow = flow_resp.json()

    put_resp = auth_session.put(
        f"{BASE_URL}/api/flow-occurrences",
        json={"flow_id": flow["id"], "month": "2026-09", "actual_amount": -480.0},
        timeout=20,
    )
    assert put_resp.status_code == 200, put_resp.text

    hist_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences/{flow['id']}/history",
        params={"month": "2026-09"},
        timeout=20,
    )
    assert hist_resp.status_code == 200
    events = hist_resp.json()
    manual_events = [e for e in events if e.get("source") == "manual" and e.get("action") == "set"]
    assert len(manual_events) >= 1, events
    e = manual_events[0]
    assert e["merge_mode"] == "override"
    assert round(float(e["new_actual_amount"]), 2) == -480.0
    # No prior actual for this freshly-created cell.
    assert e["previous_actual_amount"] in (None, 0, 0.0)


def test_manual_actual_clear_emits_history_event(auth_session, test_entity):
    """DELETE /flow-occurrences must leave a manual/clear event in the cell
    history so explicit reverts after a bulk upload are visible."""
    flow_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Manual Clear Audit",
            "amount": -700,
            "date": "2026-10-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_resp.status_code == 200
    flow = flow_resp.json()

    auth_session.put(
        f"{BASE_URL}/api/flow-occurrences",
        json={"flow_id": flow["id"], "month": "2026-10", "actual_amount": -650.0},
        timeout=20,
    )
    del_resp = auth_session.delete(
        f"{BASE_URL}/api/flow-occurrences",
        params={"flow_id": flow["id"], "month": "2026-10"},
        timeout=20,
    )
    assert del_resp.status_code == 200, del_resp.text

    hist_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences/{flow['id']}/history",
        params={"month": "2026-10"},
        timeout=20,
    )
    assert hist_resp.status_code == 200
    events = hist_resp.json()
    clears = [e for e in events if e.get("source") == "manual" and e.get("action") == "clear"]
    assert len(clears) >= 1, events
    clear_event = clears[0]
    assert clear_event["new_actual_amount"] is None
    assert round(float(clear_event["previous_actual_amount"]), 2) == -650.0


def test_bulk_import_undo_emits_reverse_history_events(auth_session, test_entity):
    """After undoing a bulk apply, the cell history must show reverse events so
    the log never lies about the current cell value."""
    flow_resp = auth_session.post(
        f"{BASE_URL}/api/cash-flows",
        json={
            "label": "TEST Bulk Undo Audit",
            "amount": -400,
            "date": "2026-11-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"],
        },
        timeout=20,
    )
    assert flow_resp.status_code == 200
    flow = flow_resp.json()

    csv_bytes = (
        b"date,description,amount\n"
        b"2026-11-05,Swisscom undo row,-110.25\n"
    )
    files = {"file": ("swisscom_undo.csv", io.BytesIO(csv_bytes), "text/csv")}
    parse_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert parse_resp.status_code == 200, parse_resp.text
    batch_id = parse_resp.json()["batch"]["id"]
    row = parse_resp.json()["rows"][0]
    auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row['id']}",
        json={
            "selected_flow_id": flow["id"], "include": True,
            "month": "2026-11", "actual_merge_mode": "override",
        },
        timeout=20,
    )
    apply_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch_id}/apply",
        json={}, timeout=30,
    )
    assert apply_resp.status_code == 200
    assert apply_resp.json().get("applied_rows", 0) == 1

    # Undo the most recent action (the bulk apply above). Note: because the
    # shared `undo_stack` is global, this test is best run in isolation — but it
    # should at least restore this particular cell from -110.25 -> None.
    undo_resp = auth_session.post(f"{BASE_URL}/api/undo", timeout=20)
    assert undo_resp.status_code == 200, undo_resp.text

    hist_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences/{flow['id']}/history",
        params={"month": "2026-11"},
        timeout=20,
    )
    assert hist_resp.status_code == 200
    events = hist_resp.json()
    undo_events = [e for e in events if e.get("source") == "undo"]
    assert len(undo_events) >= 1, (
        "Undoing a bulk apply should emit a reverse audit event so the cell "
        "history truthfully reflects the rollback. Events: " + str(events)
    )
    last_undo = undo_events[0]
    # prev was -110.25 right before undo; after undo this cell has no occurrence.
    assert round(float(last_undo["previous_actual_amount"]), 2) == -110.25
    assert last_undo["new_actual_amount"] is None
    assert last_undo["action"] == "clear"


def test_bulk_import_new_flow_creates_cash_flow_and_actual(auth_session, test_entity):
    desc = f"UNIQUE_NEW_FLOW_{uuid.uuid4().hex[:10]}"
    csv_bytes = f"date,description,amount\n2026-07-15,{desc},-333.50\n".encode("utf-8")
    files = {"file": ("newflow.csv", io.BytesIO(csv_bytes), "text/csv")}
    parse_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/parse",
        data={"entity_id": test_entity["id"]},
        files=files,
        timeout=20,
    )
    assert parse_resp.status_code == 200, parse_resp.text
    batch_id = parse_resp.json()["batch"]["id"]
    row = parse_resp.json()["rows"][0]

    upd = auth_session.put(
        f"{BASE_URL}/api/actual-imports/{batch_id}/rows/{row['id']}",
        json={"classification": "new_flow", "include": True, "month": "2026-07"},
        timeout=20,
    )
    assert upd.status_code == 200, upd.text

    apply_resp = auth_session.post(
        f"{BASE_URL}/api/actual-imports/{batch_id}/apply",
        json={},
        timeout=30,
    )
    assert apply_resp.status_code == 200, apply_resp.text
    assert apply_resp.json().get("applied_rows", 0) >= 1

    flows_resp = auth_session.get(
        f"{BASE_URL}/api/cash-flows",
        params={"entity_id": test_entity["id"]},
        timeout=20,
    )
    assert flows_resp.status_code == 200
    flows = flows_resp.json()
    match = next((f for f in flows if f.get("label") == desc), None)
    assert match is not None, "New cash flow line should be created with import description as label"

    occ_resp = auth_session.get(
        f"{BASE_URL}/api/flow-occurrences",
        params={"flow_id": match["id"], "month": "2026-07"},
        timeout=20,
    )
    assert occ_resp.status_code == 200
    occs = occ_resp.json()
    assert len(occs) >= 1
    assert round(float(occs[0]["actual_amount"]), 2) == -333.5

    auth_session.delete(f"{BASE_URL}/api/cash-flows/{match['id']}?delete_linked=true", timeout=20)
