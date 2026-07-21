"""Unit tests for bulk_flow_match (no API server)."""
from bulk_flow_match import (
    auto_select_flow_match_score,
    best_flow_match,
    choose_best_flow_match,
    flow_matches_import_direction,
    match_flow_by_label,
    normalize_flow_match_label,
)


def test_flow_matches_import_direction_uses_category_for_zero_amount_expense():
    flow = {"category": "Expense", "amount": 0.0, "is_percentage": False}
    assert flow_matches_import_direction(flow, -100.0) is True
    assert flow_matches_import_direction(flow, 100.0) is False


def test_flow_matches_import_direction_legacy_positive_expense_amount():
    flow = {"category": "Expense", "amount": 500.0, "is_percentage": False}
    assert flow_matches_import_direction(flow, -50.0) is True


def test_best_flow_match_finds_merchant_token_in_bank_description():
    flows = [
        {"id": "f1", "entity_id": "e1", "label": "Visilab", "amount": -200.0, "category": "Expense"},
    ]
    desc = "Achat Mastercard 01.05.2026 Visilab Praille"
    match = best_flow_match(flows, desc, -329.0, "e1")
    assert match["flow_id"] == "f1"
    assert match["score"] >= 0.45
    assert auto_select_flow_match_score(match["score"], match["reason"])


def test_auto_select_requires_label_signal_below_0_55():
    assert auto_select_flow_match_score(0.5, "direction") is False
    assert auto_select_flow_match_score(0.5, "direction, label-weak") is True


def test_auto_select_rejects_ambiguous_csv_label():
    assert auto_select_flow_match_score(0.9, "csv-label-exact-ambiguous") is False
    assert auto_select_flow_match_score(0.72, "csv-label-partial-ambiguous") is False


def test_best_flow_match_allows_legacy_flows_missing_entity_id():
    flows = [
        {"id": "legacy", "label": "Migros", "amount": -50.0, "category": "Expense"},
    ]
    match = best_flow_match(flows, "Achat Mastercard Migros MM Rieu", -13.26, "main")
    assert match["flow_id"] == "legacy"
    assert match["score"] > 0


def test_normalize_flow_match_label_strips_category_suffix():
    assert normalize_flow_match_label("Subscriptions - Expense") == "Subscriptions"
    assert normalize_flow_match_label("Personal expenses — Expense") == "Personal expenses"


def test_match_flow_by_label_uses_csv_flow_match_column():
    flows = [
        {"id": "f1", "entity_id": "evohom", "label": "Subscriptions", "amount": -20.0, "category": "Expense"},
        {"id": "f2", "entity_id": "family", "label": "Personal expenses", "amount": -100.0, "category": "Expense"},
    ]
    match = match_flow_by_label(flows, "Subscriptions - Expense", "evohom")
    assert match["flow_id"] == "f1"
    assert match["score"] >= 0.9
    assert auto_select_flow_match_score(match["score"], match["reason"])


def test_match_flow_by_label_cross_entity_when_scoped_misses():
    flows = [
        {"id": "f2", "entity_id": "family", "label": "Personal expenses", "amount": -100.0, "category": "Expense"},
    ]
    scoped_miss = match_flow_by_label(flows, "Personal expenses - Expense", "main")
    assert scoped_miss["flow_id"] is None
    unscoped = match_flow_by_label(flows, "Personal expenses - Expense", None)
    assert unscoped["flow_id"] == "f2"


def test_choose_best_flow_match_falls_back_when_scoped_not_auto_selectable():
    flows = [
        {"id": "noise", "entity_id": "main", "label": "Office rent", "amount": -1000.0, "category": "Expense"},
        {"id": "migros", "entity_id": "evohom", "label": "Migros", "amount": -20.0, "category": "Expense"},
    ]
    match = choose_best_flow_match(
        flows,
        "Achat Mastercard 02.06.2026 Migros MM Rieu",
        -13.26,
        "main",
    )
    assert match["flow_id"] == "migros"
    assert auto_select_flow_match_score(match["score"], match["reason"])
