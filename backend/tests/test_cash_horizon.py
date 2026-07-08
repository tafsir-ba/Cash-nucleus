import pytest
from datetime import date

from cash_horizon import (
    analyze_cash_horizon,
    resolve_expected_date,
)


TODAY = date(2026, 7, 8)


def test_resolve_expected_date_from_days():
    assert resolve_expected_date(timing_mode="days", days_from_today=45, today=TODAY) == date(2026, 8, 22)


def test_resolve_expected_date_from_date():
    assert resolve_expected_date(timing_mode="date", expected_date="2026-08-15", today=TODAY) == date(2026, 8, 15)


def test_positions_and_checkpoints():
    entries = [
        {
            "id": "1",
            "quadrant": "confirmed_inflow",
            "label": "Swissroc Invoice",
            "amount": 42000,
            "timing_mode": "date",
            "expected_date": "2026-08-15",
            "sort_order": 0,
        },
        {
            "id": "2",
            "quadrant": "confirmed_outflow",
            "label": "Payroll",
            "amount": 38000,
            "timing_mode": "date",
            "expected_date": "2026-07-31",
            "sort_order": 0,
        },
        {
            "id": "3",
            "quadrant": "potential_inflow",
            "label": "Forecast revenue",
            "amount": 70000,
            "timing_mode": "days",
            "days_from_today": 30,
            "sort_order": 0,
        },
        {
            "id": "4",
            "quadrant": "potential_outflow",
            "label": "VAT",
            "amount": 22000,
            "timing_mode": "days",
            "days_from_today": 14,
            "sort_order": 0,
        },
    ]
    analysis = analyze_cash_horizon(entries, today=TODAY)
    assert analysis["positions"]["confirmed_net_position"] == 4000
    assert analysis["positions"]["potential_net_position"] == 48000
    assert analysis["positions"]["combined_outlook"] == 52000
    assert len(analysis["checkpoints"]) == 7
    assert analysis["checkpoints"][0]["horizon"] == "Today"
    assert analysis["summary"]


def test_checkpoint_cumulative_logic():
    entries = [
        {
            "id": "a",
            "quadrant": "confirmed_inflow",
            "label": "In",
            "amount": 50000,
            "timing_mode": "days",
            "days_from_today": 5,
            "sort_order": 0,
        },
        {
            "id": "b",
            "quadrant": "confirmed_outflow",
            "label": "Out",
            "amount": 70000,
            "timing_mode": "days",
            "days_from_today": 5,
            "sort_order": 0,
        },
    ]
    analysis = analyze_cash_horizon(entries, today=TODAY)
    today_row = analysis["checkpoints"][0]
    seven_row = next(c for c in analysis["checkpoints"] if c["day_offset"] == 7)
    assert today_row["confirmed_net"] == 0
    assert seven_row["confirmed_net"] == -20000
    assert seven_row["is_negative_confirmed"] is True


def test_timeline_and_events_include_timestamps():
    entries = [
        {
            "id": "1",
            "quadrant": "confirmed_inflow",
            "label": "Invoice",
            "amount": 1000,
            "timing_mode": "date",
            "expected_date": "2026-08-01",
            "sort_order": 0,
        }
    ]
    analysis = analyze_cash_horizon(entries, today=TODAY)
    assert analysis["timeline"][0]["timestamp"] > 0
    assert analysis["cash_match_events"][0]["timestamp"] > 0
