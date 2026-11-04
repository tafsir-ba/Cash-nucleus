"""Unit tests for Evonucleus P&L → Cash Horizon bridge client."""
from __future__ import annotations

import pytest

from evonucleus_client import (
    EvonucleusError,
    extract_metric_amount,
    get_metric_def,
    list_metric_defs,
)


def test_metric_catalog_covers_user_facing_kpis():
    ids = {m["ref_id"] for m in list_metric_defs()}
    assert "invoiced_open" in ids
    assert "uninvoiced_open" in ids
    assert "arr_potential" in ids
    assert "vendor_remaining" in ids
    assert get_metric_def("invoiced_open")["field"] == "invoiced_amount_chf"
    assert get_metric_def("arr_potential")["field"] == "annual_recurring_potential"


def test_extract_ar_and_arr_amounts():
    payloads = {
        "/api/ar/summary": {
            "total_receivables_chf": 136165,
            "invoiced_amount_chf": 68588,
            "uninvoiced_amount_chf": 67577,
            "overdue_receivables_chf": 12000,
        },
        "/api/maintenance/summary": {
            "monthly_recurring_potential": 486.25,
            "annual_recurring_potential": 5835.0,
        },
        "/api/vendors/aggregation": [
            {"vendor_name": "A", "remaining_chf_reporting": 1000.5},
            {"vendor_name": "B", "remaining_chf": 250},
        ],
    }
    assert extract_metric_amount("invoiced_open", payloads) == 68588.0
    assert extract_metric_amount("uninvoiced_open", payloads) == 67577.0
    assert extract_metric_amount("total_open_ar", payloads) == 136165.0
    assert extract_metric_amount("overdue_ar", payloads) == 12000.0
    assert extract_metric_amount("arr_potential", payloads) == 5835.0
    assert extract_metric_amount("mrr_potential", payloads) == 486.25
    assert extract_metric_amount("vendor_remaining", payloads) == 1250.5


def test_extract_unknown_metric_raises():
    with pytest.raises(EvonucleusError, match="Unknown"):
        extract_metric_amount("nope", {})
