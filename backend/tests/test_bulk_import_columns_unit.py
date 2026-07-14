"""Unit tests for bulk import CSV column/date helpers (no API server needed for dates)."""
from __future__ import annotations

import os
import uuid

os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", f"bulk_col_test_{uuid.uuid4().hex[:8]}")
os.environ.setdefault("JWT_SECRET", "col-test-secret")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin123")
os.environ.setdefault("ENABLE_BULK_ACTUALS", "true")
os.environ["COOKIE_SECURE"] = "false"
os.environ["ENV"] = "test"

from mongomock_motor import AsyncMongoMockClient
import server

server.client = AsyncMongoMockClient()
server.db = server.client[os.environ["DB_NAME"]]


def test_parse_european_dotted_date_is_dayfirst():
    assert server.parse_import_row_date("03.06.2026").isoformat() == "2026-06-03"
    assert server.parse_import_row_date("02.06.2026").isoformat() == "2026-06-02"
    assert server.normalize_import_transaction_date("08.06.2026") == "2026-06-08"


def test_detect_columns_prefers_amount_over_value_date():
    detected = server.detect_import_columns(
        ["Date", "Posting text", "Amount", "Value", "Entity", "Month", "Category", "Flow match"]
    )
    assert detected["date"] == "Date"
    assert detected["description"] == "Posting text"
    assert detected["amount"] == "Amount"
    assert detected["entity"] == "Entity"
    assert detected["flow_match"] == "Flow match"
    assert detected["category"] == "Category"
    assert detected["month"] == "Month"


def test_detect_columns_treats_value_as_date_not_amount():
    detected = server.detect_import_columns(["Date", "Posting text", "Value", "Debit", "Credit"])
    # Value is a date synonym; amount should come from debit+credit pair.
    assert detected.get("amount") is None
    assert detected["debit"] == "Debit"
    assert detected["credit"] == "Credit"


def test_resolve_entity_id_from_name():
    entities = [{"id": "e1", "name": "Evohom SA"}, {"id": "e2", "name": "Family"}]
    assert server.resolve_entity_id_from_name("Evohom SA", entities) == "e1"
    assert server.resolve_entity_id_from_name("family", entities) == "e2"
    assert server.resolve_entity_id_from_name("Main Company", entities) is None
