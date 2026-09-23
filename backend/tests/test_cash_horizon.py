import pytest
from datetime import date, datetime, timezone

from cash_horizon import (
    analyze_cash_horizon,
    expand_distributed_installments,
    resolve_expected_date,
)


TODAY = date(2026, 7, 8)


def test_resolve_expected_date_from_days():
    assert resolve_expected_date(timing_mode="days", days_from_today=45, today=TODAY) == date(2026, 8, 22)


def test_resolve_expected_date_from_date():
    assert resolve_expected_date(timing_mode="date", expected_date="2026-08-15", today=TODAY) == date(2026, 8, 15)


def test_resolve_expected_date_distributed_ends_on_last_month():
    assert resolve_expected_date(
        timing_mode="distributed",
        occurrence_count=4,
        today=TODAY,
    ) == date(2026, 10, 8)


def test_distributed_installments_split_evenly():
    slices = expand_distributed_installments(amount=66000, occurrence_count=4, today=TODAY)
    assert len(slices) == 4
    assert [s["amount"] for s in slices] == [16500.0, 16500.0, 16500.0, 16500.0]
    assert slices[0]["date"] == TODAY
    assert slices[3]["date"] == date(2026, 10, 8)


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


def test_distributed_accrues_across_checkpoints():
    """COGS-style: total is booked gradually, not as a single lump sum."""
    entries = [
        {
            "id": "cogs",
            "quadrant": "confirmed_outflow",
            "label": "COGS",
            "amount": 66000,
            "timing_mode": "distributed",
            "occurrence_count": 4,
            "sort_order": 0,
        }
    ]
    analysis = analyze_cash_horizon(entries, today=TODAY)
    assert analysis["positions"]["confirmed_outflows"] == 66000
    entry = analysis["entries"][0]
    assert entry["per_occurrence_amount"] == 16500.0
    assert len(entry["installments"]) == 4

    today_row = next(c for c in analysis["checkpoints"] if c["day_offset"] == 0)
    thirty_row = next(c for c in analysis["checkpoints"] if c["day_offset"] == 30)
    ninety_row = next(c for c in analysis["checkpoints"] if c["day_offset"] == 90)
    year_row = next(c for c in analysis["checkpoints"] if c["day_offset"] == 365)

    assert today_row["confirmed_outflows"] == 16500.0
    assert thirty_row["confirmed_outflows"] == 16500.0  # next month is day 31
    assert ninety_row["confirmed_outflows"] == 49500.0  # months 0,1,2 within 90 days
    assert year_row["confirmed_outflows"] == 66000.0
    assert len(analysis["cash_match_events"]) == 4


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
    expected = int(datetime(2026, 8, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
    assert analysis["timeline"][0]["timestamp"] == expected
    assert analysis["cash_match_events"][0]["timestamp"] == expected
