"""
CREED 2 — Full System Integrity Audit
Tests that Projection = Matrix = P&L (month-details) are mathematically identical 
under all scenarios and conditions.

Scenarios:
1. Baseline: existing data, all scenario toggles (committed/likely/extended/full)
2. Distributed revenue + linked % COGS 
3. Actual override (underperformance + carry-forward)
4. Actual override (overperformance + write-off)
5. Undo after full chain (actual → carry → undo)
6. 24M and 36M horizon consistency
7. Multi-entity filtering
"""

import requests
import sys
import json
from datetime import date

API = None
RESULTS = []
PASS_COUNT = 0
FAIL_COUNT = 0

def setup():
    global API
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                API = line.strip().split("=", 1)[1] + "/api"
                break
    assert API, "Could not read REACT_APP_BACKEND_URL"

def log(scenario, test_name, passed, detail=""):
    global PASS_COUNT, FAIL_COUNT
    status = "PASS" if passed else "FAIL"
    if passed:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
    RESULTS.append({"scenario": scenario, "test": test_name, "status": status, "detail": detail})
    icon = "✓" if passed else "✗"
    print(f"  {icon} {test_name}" + (f" — {detail}" if detail and not passed else ""))

def compare_projection_vs_matrix(scenario, horizon, entity_id=None, label=""):
    """Core comparison: Projection inflows-outflows per month == Matrix net_per_month"""
    params = {"scenario": scenario, "horizon": horizon}
    if entity_id:
        params["entity_id"] = entity_id
    
    proj = requests.get(f"{API}/projection", params=params).json()
    matrix = requests.get(f"{API}/projection/matrix", params=params).json()
    
    tag = f"{label}[{scenario}/{horizon}M]"
    
    # 1. Month count match
    log(tag, "Month count", len(proj["months"]) == len(matrix["months"]),
        f"proj={len(proj['months'])}, matrix={len(matrix['months'])}")
    
    # 2. Net per month match
    all_net_match = True
    for pm in proj["months"]:
        proj_net = round(pm["inflows"] - pm["outflows"], 2)
        matrix_net = round(matrix["net_per_month"].get(pm["month"], 0), 2)
        if abs(proj_net - matrix_net) > 0.01:
            all_net_match = False
            log(tag, f"Net match {pm['month']}", False, f"proj={proj_net}, matrix={matrix_net}")
    log(tag, "Net per month (all months)", all_net_match)
    
    # 3. Revenue - Cost = Net consistency (matrix internal)
    rev_cost_net_ok = True
    for mk in matrix["net_per_month"]:
        rev = matrix["revenue_per_month"].get(mk, 0)
        cost = matrix["cost_per_month"].get(mk, 0)
        net = matrix["net_per_month"][mk]
        if abs((rev - cost) - net) > 0.01:
            rev_cost_net_ok = False
            log(tag, f"Rev-Cost=Net {mk}", False, f"rev={rev}, cost={cost}, net={net}")
    log(tag, "Rev - Cost = Net (all months)", rev_cost_net_ok)
    
    # 4. Total horizon match
    proj_total = round(sum(m["inflows"] - m["outflows"] for m in proj["months"]), 2)
    matrix_total = matrix.get("total_net", 0)
    log(tag, "Horizon total net", abs(proj_total - matrix_total) < 0.01,
        f"proj={proj_total}, matrix={matrix_total}")
    
    # 5. Cash now match
    log(tag, "Cash now", abs(proj["cash_now"] - matrix["cash_now"]) < 0.01,
        f"proj={proj['cash_now']}, matrix={matrix['cash_now']}")
    
    # 6. Cash balance per month matches projection closing (includes historical months with anchored openings)
    proj_closing = {m["month"]: m["closing_cash"] for m in proj["months"]}
    balance_ok = True
    for mk in sorted(matrix["net_per_month"].keys()):
        expected_bal = round(proj_closing.get(mk, 0), 2)
        actual_bal = round(matrix["cash_balance_per_month"].get(mk, 0), 2)
        if abs(expected_bal - actual_bal) > 0.01:
            balance_ok = False
            log(tag, f"Balance progression {mk}", False, f"expected={expected_bal}, actual={actual_bal}")
    log(tag, "Cash balance progression", balance_ok)
    
    return proj, matrix

def compare_matrix_vs_pl(scenario, horizon, month, entity_id=None, label=""):
    """Compare matrix cell amounts vs month-details amounts for a specific month."""
    params = {"scenario": scenario, "horizon": horizon}
    if entity_id:
        params["entity_id"] = entity_id
    
    matrix = requests.get(f"{API}/projection/matrix", params=params).json()
    
    pl_params = {"scenario": scenario}
    if entity_id:
        pl_params["entity_id"] = entity_id
    pl = requests.get(f"{API}/month-details/{month}", params=pl_params).json()
    
    tag = f"{label}[{scenario}/PL-vs-Matrix/{month}]"
    
    # Sum all amounts from P&L for this month
    pl_inflows = sum(f["amount"] for f in pl["all_flows"] if f["amount"] > 0)
    pl_outflows = sum(abs(f["amount"]) for f in pl["all_flows"] if f["amount"] < 0)
    pl_net = round(pl_inflows - pl_outflows, 2)
    
    matrix_net = round(matrix["net_per_month"].get(month, 0), 2)
    matrix_rev = round(matrix["revenue_per_month"].get(month, 0), 2)
    matrix_cost = round(matrix["cost_per_month"].get(month, 0), 2)
    
    log(tag, "P&L net == Matrix net", abs(pl_net - matrix_net) < 0.01,
        f"pl_net={pl_net}, matrix_net={matrix_net}")
    log(tag, "P&L inflows == Matrix revenue", abs(round(pl_inflows, 2) - matrix_rev) < 0.01,
        f"pl_inflows={round(pl_inflows, 2)}, matrix_rev={matrix_rev}")
    log(tag, "P&L outflows == Matrix cost", abs(round(pl_outflows, 2) - matrix_cost) < 0.01,
        f"pl_outflows={round(pl_outflows, 2)}, matrix_cost={matrix_cost}")
    
    return pl, matrix

def get_entity_id():
    entities = requests.get(f"{API}/entities").json()
    return entities[0]["id"] if entities else None

def create_test_flow(entity_id, label, amount, date_str, category="Revenue", certainty="Materialized", 
                     recurrence="none", recurrence_mode="repeat", recurrence_count=None):
    payload = {
        "label": label, "amount": amount, "date": date_str,
        "category": category, "certainty": certainty, "entity_id": entity_id,
        "recurrence": recurrence, "recurrence_mode": recurrence_mode,
    }
    if recurrence_count:
        payload["recurrence_count"] = recurrence_count
    return requests.post(f"{API}/cash-flows", json=payload).json()

def create_test_batch(entity_id, parent, linked_list):
    parent["entity_id"] = entity_id
    for l in linked_list:
        l["entity_id"] = entity_id
    return requests.post(f"{API}/cash-flows/batch", json={"parent": parent, "linked": linked_list}).json()

def cleanup_undo(n=1):
    for _ in range(n):
        requests.post(f"{API}/undo")


# ============================================================
# SCENARIO 1: Baseline — All scenario toggles
# ============================================================
def test_scenario_1():
    print("\n=== SCENARIO 1: Baseline — All Scenario Toggles ===")
    for sc in ["committed", "likely", "extended", "full"]:
        compare_projection_vs_matrix(sc, 12, label="Baseline")
    
    # Also test P&L match for current month
    today = date.today()
    current_month = today.strftime("%Y-%m")
    compare_matrix_vs_pl("likely", 12, current_month, label="Baseline")


# ============================================================
# SCENARIO 2: Distributed Revenue + Linked % COGS
# ============================================================
def test_scenario_2():
    print("\n=== SCENARIO 2: Distributed Revenue + Linked % COGS ===")
    entity_id = get_entity_id()
    
    # Create distributed revenue: 60000 over 6 months → 10000/month
    batch = create_test_batch(entity_id, {
        "label": "Creed2 Distributed Rev",
        "amount": 60000,
        "date": "2026-04-01",
        "category": "Revenue",
        "certainty": "Materialized",
        "recurrence": "monthly",
        "recurrence_mode": "distribute",
        "recurrence_count": 6,
    }, [{
        "label": "Creed2 COGS 40%",
        "amount": 0,
        "date": "2026-04-01",
        "category": "COGS",
        "certainty": "Materialized",
        "recurrence": "monthly",
        "recurrence_mode": "distribute",
        "recurrence_count": 6,
        "is_percentage": True,
        "percentage_of_parent": 40,
    }])
    
    parent_id = batch["parent"]["id"]
    child_id = batch["linked"][0]["id"]
    
    # Verify per-period amounts in matrix
    matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    
    # Find the parent row
    parent_row = None
    child_row = None
    for row in matrix["revenue_rows"]:
        if row["flow_id"] == parent_id:
            parent_row = row
    for row in matrix["expense_rows"]:
        if row["flow_id"] == child_id:
            child_row = row
    
    log("Distributed+COGS", "Parent row found", parent_row is not None)
    log("Distributed+COGS", "Child row found", child_row is not None)
    
    if parent_row:
        # Check first 6 months have 10000 each
        period_ok = True
        months_with_data = [mk for mk, cell in parent_row["cells"].items() if abs(cell.get("amount", 0)) > 0.01]
        for mk in months_with_data:
            amt = parent_row["cells"][mk]["amount"]
            if abs(amt - 10000) > 0.01:
                period_ok = False
                log("Distributed+COGS", f"Parent period {mk}", False, f"amount={amt}, expected=10000")
        log("Distributed+COGS", "Parent per-period = 10000", period_ok)
        log("Distributed+COGS", "Parent row_total = 60000", abs(parent_row.get("row_total", 0) - 60000) < 0.01,
            f"row_total={parent_row.get('row_total')}")
    
    if child_row:
        period_ok = True
        months_with_data = [mk for mk, cell in child_row["cells"].items() if abs(cell.get("amount", 0)) > 0.01]
        for mk in months_with_data:
            amt = child_row["cells"][mk]["amount"]
            if abs(amt - (-4000)) > 0.01:
                period_ok = False
                log("Distributed+COGS", f"Child period {mk}", False, f"amount={amt}, expected=-4000")
        log("Distributed+COGS", "Child per-period = -4000", period_ok)
        log("Distributed+COGS", "Child row_total = -24000", abs(child_row.get("row_total", 0) - (-24000)) < 0.01,
            f"row_total={child_row.get('row_total')}")
    
    # Cross-validate with projection
    compare_projection_vs_matrix("likely", 12, label="Distributed+COGS")
    
    # Cross-validate with P&L for April
    compare_matrix_vs_pl("likely", 12, "2026-04", label="Distributed+COGS")
    
    # Cleanup
    cleanup_undo(1)  # undo batch_create


# ============================================================
# SCENARIO 3: Actual Override — Underperformance + Carry Forward
# ============================================================
def test_scenario_3():
    print("\n=== SCENARIO 3: Underperformance + Carry Forward ===")
    entity_id = get_entity_id()
    
    # Snapshot baseline
    baseline_proj = requests.get(f"{API}/projection", params={"scenario": "likely", "horizon": 12}).json()
    baseline_net = round(sum(m["inflows"] - m["outflows"] for m in baseline_proj["months"]), 2)
    
    # Create test flow
    flow = create_test_flow(entity_id, "Creed2 Under Rev", 10000, "2026-04-01")
    
    # Record actual 8000 (under by 2000) with carry forward
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": flow["id"], "month": "2026-04",
        "actual_amount": 8000, "variance_action": "carry_forward",
    })
    
    # Check Projection: April should show 8000 (actual), May should have +2000 carryover
    proj = requests.get(f"{API}/projection", params={"scenario": "likely", "horizon": 12}).json()
    apr_month = next((m for m in proj["months"] if m["month"] == "2026-04"), None)
    may_month = next((m for m in proj["months"] if m["month"] == "2026-05"), None)
    
    # Total net should be same as baseline + 10000 (the flow itself)
    # because 8000 actual + 2000 carry = 10000 total, same as planned
    proj_total = round(sum(m["inflows"] - m["outflows"] for m in proj["months"]), 2)
    expected_total = round(baseline_net + 10000, 2)
    log("Under+Carry", "Total net unchanged (actual+carry = planned)",
        abs(proj_total - expected_total) < 0.01,
        f"proj_total={proj_total}, expected={expected_total}")
    
    # Cross-validate with matrix
    matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    
    # Find our flow in matrix — April cell should show actual=8000
    for row in matrix["revenue_rows"]:
        if row["flow_id"] == flow["id"]:
            apr_cell = row["cells"].get("2026-04", {})
            log("Under+Carry", "Matrix shows actual=8000",
                apr_cell.get("has_actual") and abs(apr_cell.get("actual", 0) - 8000) < 0.01,
                f"actual={apr_cell.get('actual')}, has_actual={apr_cell.get('has_actual')}")
            log("Under+Carry", "Matrix shows planned=10000",
                abs(apr_cell.get("planned", 0) - 10000) < 0.01,
                f"planned={apr_cell.get('planned')}")
            break
    
    # Verify carryover shows in May
    carryover_flows = [f for f in requests.get(f"{API}/cash-flows").json() if f.get("carryover_from") == flow["id"]]
    log("Under+Carry", "Carryover flow exists", len(carryover_flows) == 1, f"count={len(carryover_flows)}")
    if carryover_flows:
        log("Under+Carry", "Carryover amount = +2000", abs(carryover_flows[0]["amount"] - 2000) < 0.01,
            f"amount={carryover_flows[0]['amount']}")
    
    # Full cross-validation
    compare_projection_vs_matrix("likely", 12, label="Under+Carry")
    compare_matrix_vs_pl("likely", 12, "2026-04", label="Under+Carry")
    compare_matrix_vs_pl("likely", 12, "2026-05", label="Under+Carry")
    
    # Cleanup
    cleanup_undo(1)  # undo occurrence
    cleanup_undo(1)  # undo flow creation


# ============================================================
# SCENARIO 4: Actual Override — Overperformance + Write-off
# ============================================================
def test_scenario_4():
    print("\n=== SCENARIO 4: Overperformance + Write-off ===")
    entity_id = get_entity_id()
    
    baseline_matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    baseline_total = baseline_matrix["total_net"]
    
    flow = create_test_flow(entity_id, "Creed2 Over Rev", 5000, "2026-04-01")
    
    # Record actual 7000 (over by 2000) with write-off
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": flow["id"], "month": "2026-04",
        "actual_amount": 7000, "variance_action": "write_off",
    })
    
    # No carryover should exist
    carryovers = [f for f in requests.get(f"{API}/cash-flows").json() if f.get("carryover_from") == flow["id"]]
    log("Over+WriteOff", "No carryover created", len(carryovers) == 0, f"count={len(carryovers)}")
    
    # Matrix should use actual (7000) not planned (5000) → total should be baseline + 7000
    matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    expected_total = round(baseline_total + 7000, 2)
    log("Over+WriteOff", "Matrix total = baseline + actual",
        abs(matrix["total_net"] - expected_total) < 0.01,
        f"matrix={matrix['total_net']}, expected={expected_total}")
    
    # Cross-validate all three
    compare_projection_vs_matrix("likely", 12, label="Over+WriteOff")
    compare_matrix_vs_pl("likely", 12, "2026-04", label="Over+WriteOff")
    
    # Cleanup
    cleanup_undo(1)  # undo occurrence
    cleanup_undo(1)  # undo flow


# ============================================================
# SCENARIO 5: Full Undo Chain — No Drift
# ============================================================
def test_scenario_5():
    print("\n=== SCENARIO 5: Full Undo Chain — Zero Drift ===")
    entity_id = get_entity_id()
    
    # Capture exact baseline state
    baseline = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    baseline_rev = baseline["total_revenue"]
    baseline_cost = baseline["total_cost"]
    baseline_net = baseline["total_net"]
    baseline_flows = len(requests.get(f"{API}/cash-flows").json())
    
    # Step 1: Create flow
    flow = create_test_flow(entity_id, "Creed2 UndoChain", 15000, "2026-04-01")
    
    # Step 2: Record actual with carry-forward
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": flow["id"], "month": "2026-04",
        "actual_amount": 12000, "variance_action": "carry_forward",
    })
    
    # Step 3: Undo carry-forward recording
    requests.post(f"{API}/undo")
    
    # Verify: occurrence removed, carryover removed, flow still exists
    occs = requests.get(f"{API}/flow-occurrences", params={"flow_id": flow["id"], "month": "2026-04"}).json()
    carryovers = [f for f in requests.get(f"{API}/cash-flows").json() if f.get("carryover_from") == flow["id"]]
    log("UndoChain", "Occurrence removed after undo", len(occs) == 0)
    log("UndoChain", "Carryover removed after undo", len(carryovers) == 0)
    
    # Matrix should show planned (15000) not actual
    matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    for row in matrix["revenue_rows"]:
        if row["flow_id"] == flow["id"]:
            apr_cell = row["cells"].get("2026-04", {})
            log("UndoChain", "Cell reverted to planned",
                not apr_cell.get("has_actual") and abs(apr_cell.get("amount", 0) - 15000) < 0.01)
            break
    
    # Step 4: Undo flow creation
    requests.post(f"{API}/undo")
    
    # Verify: back to exact baseline
    after = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    after_flows = len(requests.get(f"{API}/cash-flows").json())
    
    log("UndoChain", "Total revenue restored", abs(after["total_revenue"] - baseline_rev) < 0.01,
        f"before={baseline_rev}, after={after['total_revenue']}")
    log("UndoChain", "Total cost restored", abs(after["total_cost"] - baseline_cost) < 0.01,
        f"before={baseline_cost}, after={after['total_cost']}")
    log("UndoChain", "Total net restored", abs(after["total_net"] - baseline_net) < 0.01,
        f"before={baseline_net}, after={after['total_net']}")
    log("UndoChain", "Flow count restored", after_flows == baseline_flows,
        f"before={baseline_flows}, after={after_flows}")


# ============================================================
# SCENARIO 6: 24M and 36M Horizon Consistency
# ============================================================
def test_scenario_6():
    print("\n=== SCENARIO 6: 24M and 36M Horizon ===")
    for h in [24, 36]:
        compare_projection_vs_matrix("likely", h, label=f"Horizon-{h}M")
    
    # Also test that 12M is a subset of 24M
    m12 = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    m24 = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 24}).json()
    
    # First 12 months of 24M should match 12M exactly
    subset_ok = True
    for mk in m12["net_per_month"]:
        n12 = round(m12["net_per_month"][mk], 2)
        n24 = round(m24["net_per_month"].get(mk, -999999), 2)
        if abs(n12 - n24) > 0.01:
            subset_ok = False
            log("Horizon", f"12M subset {mk}", False, f"12M={n12}, 24M={n24}")
    log("Horizon", "12M is exact subset of 24M", subset_ok)


# ============================================================
# SCENARIO 7: Multi-Entity Filtering
# ============================================================
def test_scenario_7():
    print("\n=== SCENARIO 7: Multi-Entity Filtering ===")
    entities = requests.get(f"{API}/entities").json()
    
    if len(entities) < 2:
        print("  (skipping — only 1 entity)")
        log("Entity", "Needs 2+ entities", False, "Only 1 entity, cannot test filter")
        return
    
    # Compare filtered vs unfiltered
    total_matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    
    entity_nets = []
    for ent in entities:
        ent_matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12, "entity_id": ent["id"]}).json()
        entity_nets.append(ent_matrix["total_net"])
        # Each entity should also pass internal consistency
        compare_projection_vs_matrix("likely", 12, entity_id=ent["id"], label=f"Entity-{ent['name'][:8]}")
    
    # Sum of entity totals should equal unfiltered total
    entity_sum = round(sum(entity_nets), 2)
    log("Entity", "Sum of entity totals == unfiltered total",
        abs(entity_sum - total_matrix["total_net"]) < 0.01,
        f"sum={entity_sum}, total={total_matrix['total_net']}")


# ============================================================
# SCENARIO 8: No duplicate computation (code review)
# ============================================================
def test_scenario_8():
    print("\n=== SCENARIO 8: SSOT Code Review ===")
    
    # Check frontend for any .reduce() calls on backend data
    with open("/app/frontend/src/components/CashFlowTable.jsx") as f:
        content = f.read()
    
    has_reduce = ".reduce(" in content
    has_calcRowTotal = "calcRowTotal" in content
    has_sum = "Object.values(" in content and ".reduce(" in content
    
    log("SSOT", "No .reduce() in CashFlowTable", not has_reduce, 
        "Found .reduce()" if has_reduce else "Clean")
    log("SSOT", "No calcRowTotal", not has_calcRowTotal,
        "Found calcRowTotal" if has_calcRowTotal else "Clean")
    
    # Check that matrix response has all required backend-computed fields
    matrix = requests.get(f"{API}/projection/matrix", params={"scenario": "likely", "horizon": 12}).json()
    log("SSOT", "Has total_revenue", "total_revenue" in matrix)
    log("SSOT", "Has total_cost", "total_cost" in matrix)
    log("SSOT", "Has total_net", "total_net" in matrix)
    
    # Check row_total exists on rows
    if matrix["revenue_rows"]:
        log("SSOT", "Revenue rows have row_total", "row_total" in matrix["revenue_rows"][0])
    if matrix["expense_rows"]:
        log("SSOT", "Expense rows have row_total", "row_total" in matrix["expense_rows"][0])


# ============================================================
# RUN ALL
# ============================================================
def main():
    setup()
    print("=" * 60)
    print("  CREED 2 — FULL SYSTEM INTEGRITY AUDIT")
    print("=" * 60)
    
    test_scenario_1()  # All scenario toggles
    test_scenario_2()  # Distributed + COGS
    test_scenario_3()  # Under + carry forward
    test_scenario_4()  # Over + write-off
    test_scenario_5()  # Full undo chain
    test_scenario_6()  # 24M + 36M horizons
    test_scenario_7()  # Multi-entity
    test_scenario_8()  # SSOT code review
    
    print("\n" + "=" * 60)
    print(f"  AUDIT COMPLETE: {PASS_COUNT} PASS / {FAIL_COUNT} FAIL / {PASS_COUNT + FAIL_COUNT} TOTAL")
    print("=" * 60)
    
    # Write report
    report = {
        "audit": "Creed 2 — Full System Integrity",
        "pass_count": PASS_COUNT,
        "fail_count": FAIL_COUNT,
        "total": PASS_COUNT + FAIL_COUNT,
        "status": "PASS" if FAIL_COUNT == 0 else "FAIL",
        "results": RESULTS,
    }
    with open("/app/test_reports/creed2_audit.json", "w") as f:
        json.dump(report, f, indent=2)
    
    if FAIL_COUNT > 0:
        print("\nFAILED TESTS:")
        for r in RESULTS:
            if r["status"] == "FAIL":
                print(f"  ✗ [{r['scenario']}] {r['test']}: {r['detail']}")
        sys.exit(1)
    else:
        print("\n  ALL TESTS PASSED — System is mathematically consistent.")

if __name__ == "__main__":
    main()
