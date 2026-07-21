"""Unit tests for cash-flow matrix actual-only month cells (no API server)."""


def merge_actual_only_into_flow_month_map(
    *,
    flow_month_map: dict,
    flow_info: dict,
    actuals_map: dict,
    planned_map: dict,
    month_keys: list,
    filtered_ids: set,
    flows_by_id: dict,
    revenue_category: str = "Revenue",
) -> None:
    """Mirror of server matrix injection — kept pure for unit testing."""
    month_key_set = set(month_keys)
    for (fid, mkey), actual_amt in actuals_map.items():
        if not fid or mkey not in month_key_set:
            continue
        if fid not in filtered_ids and fid not in flow_info:
            continue
        src = flows_by_id.get(fid)
        if not src:
            continue
        if fid not in flow_month_map:
            flow_month_map[fid] = {}
        if mkey in flow_month_map[fid]:
            continue
        planned_amt = float(src.get("amount", 0) or 0)
        cat = src.get("category", "Expense")
        cat_val = cat if isinstance(cat, str) else str(cat)
        is_rev = (cat_val == revenue_category) or planned_amt > 0
        if fid not in flow_info:
            flow_info[fid] = {
                "flow_id": fid,
                "label": src.get("label", ""),
                "category": cat_val,
                "is_revenue": is_rev,
            }
        flow_month_map[fid][mkey] = float(actual_amt)


def test_actual_only_june_appears_when_no_planned():
    flow_month_map = {
        "av": {"2026-04": 18400.0},  # planned only in April
    }
    flow_info = {
        "av": {"flow_id": "av", "label": "Avance Trésorerie", "category": "Revenue", "is_revenue": True},
    }
    actuals_map = {("av", "2026-06"): 33215.55}
    planned_map = {("av", "2026-04"): 18400.0}
    merge_actual_only_into_flow_month_map(
        flow_month_map=flow_month_map,
        flow_info=flow_info,
        actuals_map=actuals_map,
        planned_map=planned_map,
        month_keys=["2026-04", "2026-05", "2026-06"],
        filtered_ids={"av"},
        flows_by_id={"av": {"id": "av", "label": "Avance Trésorerie", "category": "Revenue", "amount": 18400}},
    )
    assert flow_month_map["av"]["2026-06"] == 33215.55
    assert "2026-05" not in flow_month_map["av"]


def test_actual_only_does_not_override_planned_month():
    flow_month_map = {"av": {"2026-06": 100.0}}  # already from expansion
    flow_info = {"av": {"flow_id": "av", "label": "Avance", "category": "Revenue", "is_revenue": True}}
    merge_actual_only_into_flow_month_map(
        flow_month_map=flow_month_map,
        flow_info=flow_info,
        actuals_map={("av", "2026-06"): 33215.55},
        planned_map={("av", "2026-06"): 100.0},
        month_keys=["2026-06"],
        filtered_ids={"av"},
        flows_by_id={"av": {"id": "av", "label": "Avance", "category": "Revenue", "amount": 100}},
    )
    # Overlay already handled elsewhere; injector must not clobber
    assert flow_month_map["av"]["2026-06"] == 100.0
