"""Unit tests for bulk_import_columns (no API server)."""
from bulk_import_columns import (
    DEFAULT_CATEGORY_VALUES,
    detect_import_columns,
    flow_display_label,
    normalize_month_cell,
    parse_category_label,
    resolve_entity_id_from_name,
    resolve_flow_from_match_text,
)


def test_detect_enriched_excel_headers():
    headers = [
        "Date",
        "Posting text",
        "Amount",
        "Value",
        "Entity",
        "Month",
        "Category",
        "Flow match",
    ]
    detected = detect_import_columns(headers)
    assert detected["date"] == "Date"
    assert detected["description"] == "Posting text"
    assert detected["amount"] == "Amount"
    assert detected["value_date"] == "Value"
    assert detected["entity"] == "Entity"
    assert detected["month"] == "Month"
    assert detected["category"] == "Category"
    assert detected["flow_match"] == "Flow match"


def test_detect_value_as_amount_when_no_amount_column():
    detected = detect_import_columns(["Date", "Description", "Value"])
    assert detected["date"] == "Date"
    assert detected["description"] == "Description"
    assert detected["amount"] == "Value"
    assert "value_date" not in detected


def test_detect_value_date_only_promotes_to_date():
    detected = detect_import_columns(["Value date", "Posting text", "Amount"])
    assert detected["date"] == "Value date"
    assert detected["amount"] == "Amount"
    assert detected["description"] == "Posting text"


def test_detect_rejects_broad_type_and_line_aliases():
    detected = detect_import_columns(["Date", "Posting text", "Amount", "Type", "Line"])
    assert "category" not in detected
    assert "flow_match" not in detected


def test_normalize_month_cell():
    assert normalize_month_cell("2026-06") == "2026-06"
    assert normalize_month_cell("2026/6") == "2026-06"
    assert normalize_month_cell("202606") == "2026-06"
    assert normalize_month_cell("bad") is None


def test_parse_category_label():
    assert parse_category_label("Expense") == "Expense"
    assert parse_category_label("revenue") == "Revenue"
    assert parse_category_label("COGS") == "COGS"
    assert parse_category_label("unknown-thing") is None


def test_default_category_values_match_server_enum():
    import os
    import uuid as _uuid

    os.environ.setdefault("MONGO_URL", "mongodb://localhost")
    os.environ.setdefault("DB_NAME", f"cat_ssot_{_uuid.uuid4().hex[:8]}")
    os.environ.setdefault("JWT_SECRET", "test")
    os.environ.setdefault("ENABLE_BULK_ACTUALS", "true")
    from server import Category

    assert set(DEFAULT_CATEGORY_VALUES) == {c.value for c in Category}


def test_resolve_entity_id_from_name_exact_only():
    entities = [
        {"id": "e1", "name": "Evohom SA"},
        {"id": "e2", "name": "Family"},
        {"id": "main", "name": "Main Company"},
    ]
    assert resolve_entity_id_from_name("Family", entities) == "e2"
    assert resolve_entity_id_from_name("evohom sa", entities) == "e1"
    assert resolve_entity_id_from_name("", entities, default_entity_id="main") == "main"
    # Non-empty unknown must NOT silently fall back to default
    assert resolve_entity_id_from_name("Missing", entities, default_entity_id="main") is None
    # Partial / contains must not match
    assert resolve_entity_id_from_name("SA", entities, default_entity_id="main") is None
    assert resolve_entity_id_from_name("Ev", entities, default_entity_id="main") is None


def test_resolve_flow_from_match_text_ui_label():
    flows = [
        {"id": "f1", "label": "Subscriptions", "category": "Expense", "entity_id": "e1"},
        {"id": "f2", "label": "Personal expenses", "category": "Expense", "entity_id": "e2"},
    ]
    assert flow_display_label(flows[0]) == "Subscriptions - Expense"
    hit = resolve_flow_from_match_text(flows, "Subscriptions - Expense", entity_id="e1")
    assert hit and hit["id"] == "f1"
    hit2 = resolve_flow_from_match_text(flows, "Personal expenses", entity_id="e2")
    assert hit2 and hit2["id"] == "f2"
    assert resolve_flow_from_match_text(flows, "Unmatched", entity_id="e1") is None
