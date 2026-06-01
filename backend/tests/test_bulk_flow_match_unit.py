"""Unit tests for bulk_flow_match (no API server)."""
from bulk_flow_match import (
    auto_select_flow_match_score,
    best_flow_match,
    flow_matches_import_direction,
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
