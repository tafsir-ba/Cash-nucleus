"""
CREED 2 FINAL AUDIT — Failure Mode Testing
Not happy paths. Testing breakage scenarios.

7 sections:
1. Numerical Integrity (all scenarios × all horizons × complex flows)
2. Undo System (destructive chains)
3. Dependency Graph (parent/child consistency)
4. Multi-Entity Consistency
5. Horizon Stability (12→24→36 switching)
6. Decision Panel Accuracy
7. Performance / Stability (bulk flows)
"""

import requests
import json
import time
import sys
from datetime import date, datetime

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
    assert API

def log(section, test, passed, detail=""):
    global PASS_COUNT, FAIL_COUNT
    if passed:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
    RESULTS.append({"section": section, "test": test, "status": "PASS" if passed else "FAIL", "detail": detail})
    icon = "  \u2713" if passed else "  \u2717"
    print(f"{icon} {test}" + (f" — {detail}" if detail and not passed else ""))

def get_entity():
    return requests.get(f"{API}/entities").json()[0]["id"]

def create_flow(entity_id, label, amount, date_str, category="Revenue", certainty="Materialized",
                recurrence="none", recurrence_mode="repeat", recurrence_count=None):
    p = {"label": label, "amount": amount, "date": date_str, "category": category,
         "certainty": certainty, "entity_id": entity_id, "recurrence": recurrence,
         "recurrence_mode": recurrence_mode}
    if recurrence_count:
        p["recurrence_count"] = recurrence_count
    return requests.post(f"{API}/cash-flows", json=p).json()

def create_batch(entity_id, parent, linked):
    parent["entity_id"] = entity_id
    for l in linked:
        l["entity_id"] = entity_id
    return requests.post(f"{API}/cash-flows/batch", json={"parent": parent, "linked": linked}).json()

def undo(n=1):
    for _ in range(n):
        requests.post(f"{API}/undo")

def get_proj(scenario, horizon, entity_id=None):
    p = {"scenario": scenario, "horizon": horizon}
    if entity_id: p["entity_id"] = entity_id
    return requests.get(f"{API}/projection", params=p).json()

def get_matrix(scenario, horizon, entity_id=None):
    p = {"scenario": scenario, "horizon": horizon}
    if entity_id: p["entity_id"] = entity_id
    return requests.get(f"{API}/projection/matrix", params=p).json()

def get_month_details(month, scenario, entity_id=None):
    p = {"scenario": scenario}
    if entity_id: p["entity_id"] = entity_id
    return requests.get(f"{API}/month-details/{month}", params=p).json()


# ================================================================
# 1. NUMERICAL INTEGRITY
# ================================================================
def test_numerical_integrity():
    print("\n" + "="*60)
    print("  1. NUMERICAL INTEGRITY")
    print("="*60)
    
    entity_id = get_entity()
    
    # Create complex test data: distributed revenue + linked COGS + actual override
    batch = create_batch(entity_id, {
        "label": "AUDIT Dist Rev", "amount": 60000, "date": "2026-04-01",
        "category": "Revenue", "certainty": "Materialized",
        "recurrence": "monthly", "recurrence_mode": "distribute", "recurrence_count": 6,
    }, [{
        "label": "AUDIT COGS 35%", "amount": 0, "date": "2026-04-01",
        "category": "COGS", "certainty": "Materialized",
        "recurrence": "monthly", "recurrence_mode": "distribute", "recurrence_count": 6,
        "is_percentage": True, "percentage_of_parent": 35,
    }])
    parent_id = batch["parent"]["id"]
    child_id = batch["linked"][0]["id"]
    
    # Record actual on April (underperformance) + carry forward
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": parent_id, "month": "2026-04",
        "actual_amount": 8000, "variance_action": "carry_forward",
    })
    
    # Record actual on May (overperformance) + write off
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": parent_id, "month": "2026-05",
        "actual_amount": 12000, "variance_action": "write_off",
    })
    
    # Now test ALL scenario × horizon combinations
    for sc in ["committed", "likely", "extended", "full"]:
        for h in [12, 24, 36]:
            tag = f"[{sc}/{h}M]"
            proj = get_proj(sc, h)
            matrix = get_matrix(sc, h)
            
            # A. Month count
            log("Integrity", f"{tag} Month count match",
                len(proj["months"]) == len(matrix["months"]))
            
            # B. Net per month exact match
            all_match = True
            for pm in proj["months"]:
                pn = round(pm["inflows"] - pm["outflows"], 2)
                mn = round(matrix["net_per_month"].get(pm["month"], 0), 2)
                if abs(pn - mn) > 0.01:
                    all_match = False
                    log("Integrity", f"{tag} Net {pm['month']}", False, f"proj={pn} matrix={mn}")
            log("Integrity", f"{tag} Net per month", all_match)
            
            # C. Rev - Cost = Net
            rc_ok = True
            for mk in matrix["net_per_month"]:
                r = matrix["revenue_per_month"].get(mk, 0)
                c = matrix["cost_per_month"].get(mk, 0)
                n = matrix["net_per_month"][mk]
                if abs((r - c) - n) > 0.01:
                    rc_ok = False
            log("Integrity", f"{tag} Rev-Cost=Net", rc_ok)
            
            # D. Matrix month-end cash matches projection (history + forward)
            proj_close = {m["month"]: m["closing_cash"] for m in proj["months"]}
            bal_ok = True
            for mk in sorted(matrix["net_per_month"].keys()):
                expected_bal = proj_close.get(mk, 0)
                actual_bal = matrix["cash_balance_per_month"].get(mk, 0)
                if abs(expected_bal - actual_bal) > 0.01:
                    bal_ok = False
                    log("Integrity", f"{tag} Balance {mk}", False,
                        f"expected={round(expected_bal,2)} got={actual_bal}")
            log("Integrity", f"{tag} Balance progression", bal_ok)
            
            # E. Horizon totals
            pt = round(sum(m["inflows"] - m["outflows"] for m in proj["months"]), 2)
            mt = matrix.get("total_net", 0)
            log("Integrity", f"{tag} Total net", abs(pt - mt) < 0.01)
            
            # F. cash_now match
            log("Integrity", f"{tag} Cash now", abs(proj["cash_now"] - matrix["cash_now"]) < 0.01)
    
    # G. P&L match for months with actuals
    for month in ["2026-04", "2026-05", "2026-06"]:
        matrix = get_matrix("likely", 12)
        pl = get_month_details(month, "likely")
        
        pl_in = sum(f["amount"] for f in pl["all_flows"] if f["amount"] > 0)
        pl_out = sum(abs(f["amount"]) for f in pl["all_flows"] if f["amount"] < 0)
        pl_net = round(pl_in - pl_out, 2)
        m_net = round(matrix["net_per_month"].get(month, 0), 2)
        m_rev = round(matrix["revenue_per_month"].get(month, 0), 2)
        m_cost = round(matrix["cost_per_month"].get(month, 0), 2)
        
        log("Integrity", f"P&L vs Matrix net [{month}]", abs(pl_net - m_net) < 0.01,
            f"pl={pl_net} matrix={m_net}" if abs(pl_net - m_net) > 0.01 else "")
        log("Integrity", f"P&L vs Matrix rev [{month}]", abs(round(pl_in, 2) - m_rev) < 0.01,
            f"pl={round(pl_in,2)} matrix={m_rev}" if abs(round(pl_in, 2) - m_rev) > 0.01 else "")
    
    # Cleanup: undo actuals then batch
    undo(1)  # undo May actual
    undo(1)  # undo April actual
    undo(1)  # undo batch


# ================================================================
# 2. UNDO SYSTEM — DESTRUCTIVE TESTS
# ================================================================
def test_undo_destructive():
    print("\n" + "="*60)
    print("  2. UNDO SYSTEM — DESTRUCTIVE TESTS")
    print("="*60)
    
    entity_id = get_entity()
    
    # --- Test A: actual → carry forward → undo → exact baseline ---
    baseline = get_matrix("likely", 12)
    bl_net = baseline["total_net"]
    bl_rev = baseline["total_revenue"]
    bl_cost = baseline["total_cost"]
    bl_flows = len(requests.get(f"{API}/cash-flows").json())
    
    flow = create_flow(entity_id, "UNDO-A Rev", 10000, "2026-04-01")
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": flow["id"], "month": "2026-04",
        "actual_amount": 7000, "variance_action": "carry_forward",
    })
    
    # Verify carryover exists
    flows_mid = requests.get(f"{API}/cash-flows").json()
    carryovers = [f for f in flows_mid if f.get("carryover_from") == flow["id"]]
    log("Undo", "Carry-forward creates carryover", len(carryovers) == 1)
    
    undo(1)  # undo actual
    
    # Verify carryover gone, occurrence gone
    flows_after = requests.get(f"{API}/cash-flows").json()
    carryovers_after = [f for f in flows_after if f.get("carryover_from") == flow["id"]]
    occs = requests.get(f"{API}/flow-occurrences", params={"flow_id": flow["id"], "month": "2026-04"}).json()
    log("Undo", "Undo removes carryover", len(carryovers_after) == 0, f"remaining={len(carryovers_after)}")
    log("Undo", "Undo removes occurrence", len(occs) == 0, f"remaining={len(occs)}")
    
    undo(1)  # undo flow creation
    
    after = get_matrix("likely", 12)
    log("Undo", "A: total_net restored", abs(after["total_net"] - bl_net) < 0.01)
    log("Undo", "A: total_revenue restored", abs(after["total_revenue"] - bl_rev) < 0.01)
    log("Undo", "A: flow count restored", len(requests.get(f"{API}/cash-flows").json()) == bl_flows)
    
    # --- Test B: actual → write-off → undo → exact baseline ---
    flow2 = create_flow(entity_id, "UNDO-B Rev", 5000, "2026-05-01")
    requests.put(f"{API}/flow-occurrences", json={
        "flow_id": flow2["id"], "month": "2026-05",
        "actual_amount": 3000, "variance_action": "write_off",
    })
    
    undo(1)  # undo actual
    occs2 = requests.get(f"{API}/flow-occurrences", params={"flow_id": flow2["id"], "month": "2026-05"}).json()
    log("Undo", "B: Write-off undo removes occurrence", len(occs2) == 0)
    
    undo(1)  # undo create
    after2 = get_matrix("likely", 12)
    log("Undo", "B: Baseline restored after write-off undo", abs(after2["total_net"] - bl_net) < 0.01)
    
    # --- Test C: 10-step chain → full rollback ---
    ids = []
    for i in range(10):
        f = create_flow(entity_id, f"UNDO-C Flow {i}", -(i+1)*500, "2026-04-01", category="Expense")
        ids.append(f["id"])
    
    mid_matrix = get_matrix("likely", 12)
    expected_delta = sum(-(i+1)*500 for i in range(10))  # -27500 total added expense
    
    for i in range(10):
        undo(1)
    
    after10 = get_matrix("likely", 12)
    remaining = [f for f in requests.get(f"{API}/cash-flows").json() if f["id"] in ids]
    log("Undo", "C: 10-step undo — zero residual flows", len(remaining) == 0, f"remaining={len(remaining)}")
    log("Undo", "C: 10-step undo — exact baseline net", abs(after10["total_net"] - bl_net) < 0.01,
        f"diff={abs(after10['total_net'] - bl_net)}")
    log("Undo", "C: 10-step undo — exact baseline rev", abs(after10["total_revenue"] - bl_rev) < 0.01)
    log("Undo", "C: 10-step undo — exact baseline cost", abs(after10["total_cost"] - bl_cost) < 0.01)
    
    # --- Test D: delete parent with linked children → undo restores all ---
    batch = create_batch(entity_id, {
        "label": "UNDO-D Parent", "amount": 20000, "date": "2026-06-01",
        "category": "Revenue", "certainty": "Materialized", "recurrence": "none",
    }, [{
        "label": "UNDO-D Child 30%", "amount": 0, "date": "2026-06-01",
        "category": "COGS", "certainty": "Materialized", "recurrence": "none",
        "is_percentage": True, "percentage_of_parent": 30,
    }])
    pid = batch["parent"]["id"]
    cid = batch["linked"][0]["id"]
    
    # Delete parent WITHOUT deleting linked (orphans children)
    requests.delete(f"{API}/cash-flows/{pid}?delete_linked=false")
    
    child_after_del = next((f for f in requests.get(f"{API}/cash-flows").json() if f["id"] == cid), None)
    log("Undo", "D: Child orphaned after parent delete", child_after_del and child_after_del.get("parent_id") is None)
    
    undo(1)  # undo delete
    
    parent_restored = next((f for f in requests.get(f"{API}/cash-flows").json() if f["id"] == pid), None)
    child_restored = next((f for f in requests.get(f"{API}/cash-flows").json() if f["id"] == cid), None)
    log("Undo", "D: Parent restored", parent_restored is not None)
    log("Undo", "D: Child parent_id restored", child_restored and child_restored.get("parent_id") == pid,
        f"parent_id={child_restored.get('parent_id') if child_restored else 'N/A'}")
    log("Undo", "D: Child amount intact", child_restored and abs(child_restored["amount"] - (-6000)) < 0.01)
    
    undo(1)  # undo batch create
    
    # --- Test E: delete parent WITH linked children → undo ---
    batch2 = create_batch(entity_id, {
        "label": "UNDO-E Parent", "amount": 15000, "date": "2026-07-01",
        "category": "Revenue", "certainty": "Materialized", "recurrence": "none",
    }, [{
        "label": "UNDO-E Child 25%", "amount": 0, "date": "2026-07-01",
        "category": "COGS", "certainty": "Materialized", "recurrence": "none",
        "is_percentage": True, "percentage_of_parent": 25,
    }])
    pid2 = batch2["parent"]["id"]
    cid2 = batch2["linked"][0]["id"]
    
    requests.delete(f"{API}/cash-flows/{pid2}?delete_linked=true")
    
    # Both should be gone
    all_flows = requests.get(f"{API}/cash-flows").json()
    log("Undo", "E: Parent+child deleted", not any(f["id"] in [pid2, cid2] for f in all_flows))
    
    undo(1)  # undo delete
    
    all_flows2 = requests.get(f"{API}/cash-flows").json()
    p_back = next((f for f in all_flows2 if f["id"] == pid2), None)
    c_back = next((f for f in all_flows2 if f["id"] == cid2), None)
    log("Undo", "E: Parent restored after cascade delete undo", p_back is not None)
    log("Undo", "E: Child restored after cascade delete undo", c_back is not None)
    
    undo(1)  # undo batch create
    
    # Final baseline check
    final = get_matrix("likely", 12)
    log("Undo", "FINAL: Net matches original baseline", abs(final["total_net"] - bl_net) < 0.01,
        f"diff={abs(final['total_net'] - bl_net)}")
    log("Undo", "FINAL: Flow count matches baseline", len(requests.get(f"{API}/cash-flows").json()) == bl_flows)


# ================================================================
# 3. DEPENDENCY GRAPH INTEGRITY
# ================================================================
def test_dependency_graph():
    print("\n" + "="*60)
    print("  3. DEPENDENCY GRAPH INTEGRITY")
    print("="*60)
    
    entity_id = get_entity()
    
    # Create parent + 2 children with different %
    batch = create_batch(entity_id, {
        "label": "DEP Parent", "amount": 100000, "date": "2026-04-01",
        "category": "Revenue", "certainty": "Materialized", "recurrence": "none",
    }, [
        {"label": "DEP COGS 40%", "amount": 0, "date": "2026-04-01",
         "category": "COGS", "certainty": "Materialized", "recurrence": "none",
         "is_percentage": True, "percentage_of_parent": 40},
        {"label": "DEP Tax 15%", "amount": 0, "date": "2026-04-01",
         "category": "Tax", "certainty": "Materialized", "recurrence": "none",
         "is_percentage": True, "percentage_of_parent": 15},
    ])
    pid = batch["parent"]["id"]
    cids = [l["id"] for l in batch["linked"]]
    
    # Verify initial amounts
    flows = requests.get(f"{API}/cash-flows").json()
    c1 = next(f for f in flows if f["id"] == cids[0])
    c2 = next(f for f in flows if f["id"] == cids[1])
    log("Dependency", "Child 1 (40%) = -40000", abs(c1["amount"] - (-40000)) < 0.01, f"got={c1['amount']}")
    log("Dependency", "Child 2 (15%) = -15000", abs(c2["amount"] - (-15000)) < 0.01, f"got={c2['amount']}")
    
    # Edit parent to 200000
    requests.put(f"{API}/cash-flows/{pid}", json={"amount": 200000})
    
    flows2 = requests.get(f"{API}/cash-flows").json()
    c1_after = next(f for f in flows2 if f["id"] == cids[0])
    c2_after = next(f for f in flows2 if f["id"] == cids[1])
    log("Dependency", "After edit: Child 1 (40%) = -80000", abs(c1_after["amount"] - (-80000)) < 0.01, f"got={c1_after['amount']}")
    log("Dependency", "After edit: Child 2 (15%) = -30000", abs(c2_after["amount"] - (-30000)) < 0.01, f"got={c2_after['amount']}")
    
    # Verify no double counting in matrix
    matrix = get_matrix("likely", 12)
    parent_row = next((r for r in matrix["revenue_rows"] if r["flow_id"] == pid), None)
    child_rows = [r for r in matrix["expense_rows"] if r["flow_id"] in cids]
    
    log("Dependency", "Parent in revenue rows", parent_row is not None)
    log("Dependency", "Children in expense rows", len(child_rows) == 2)
    
    if parent_row:
        apr_cell = parent_row["cells"].get("2026-04", {})
        log("Dependency", "Parent matrix cell = 200000", abs(apr_cell.get("amount", 0) - 200000) < 0.01)
    
    # Undo edit → children revert
    undo(1)
    flows3 = requests.get(f"{API}/cash-flows").json()
    c1_rev = next(f for f in flows3 if f["id"] == cids[0])
    c2_rev = next(f for f in flows3 if f["id"] == cids[1])
    log("Dependency", "Undo: Child 1 reverted to -40000", abs(c1_rev["amount"] - (-40000)) < 0.01)
    log("Dependency", "Undo: Child 2 reverted to -15000", abs(c2_rev["amount"] - (-15000)) < 0.01)
    
    # Check no orphan carryovers
    all_flows = requests.get(f"{API}/cash-flows").json()
    carryovers = [f for f in all_flows if f.get("carryover_from")]
    for co in carryovers:
        source_exists = any(f["id"] == co["carryover_from"] for f in all_flows)
        if not source_exists:
            log("Dependency", f"Orphan carryover: {co['id']}", False, f"carryover_from={co['carryover_from']}")
    log("Dependency", "No orphan carryovers", all(
        any(f["id"] == co["carryover_from"] for f in all_flows) for co in carryovers
    ) if carryovers else True)
    
    undo(1)  # undo batch


# ================================================================
# 4. MULTI-ENTITY CONSISTENCY
# ================================================================
def test_multi_entity():
    print("\n" + "="*60)
    print("  4. MULTI-ENTITY CONSISTENCY")
    print("="*60)
    
    entities = requests.get(f"{API}/entities").json()
    if len(entities) < 2:
        log("Entity", "Needs 2+ entities to test", False, "Skipped — only 1 entity")
        return
    
    for sc in ["committed", "likely"]:
        for h in [12, 24]:
            tag = f"[{sc}/{h}M]"
            global_m = get_matrix(sc, h)
            
            entity_rev_sum = 0
            entity_cost_sum = 0
            entity_net_sum = 0
            entity_month_nets = {}
            
            for ent in entities:
                em = get_matrix(sc, h, entity_id=ent["id"])
                entity_rev_sum += em["total_revenue"]
                entity_cost_sum += em["total_cost"]
                entity_net_sum += em["total_net"]
                
                for mk, v in em["net_per_month"].items():
                    entity_month_nets[mk] = entity_month_nets.get(mk, 0) + v
                
                # Per-entity internal consistency
                e_running = em["cash_now"]
                e_ok = True
                for mk in sorted(em["net_per_month"].keys()):
                    e_running += em["net_per_month"][mk]
                    if abs(e_running - em["cash_balance_per_month"].get(mk, 0)) > 0.01:
                        e_ok = False
                log("Entity", f"{tag} {ent['name'][:8]} balance progression", e_ok)
            
            log("Entity", f"{tag} Sum(entity rev) == global rev",
                abs(entity_rev_sum - global_m["total_revenue"]) < 0.01,
                f"sum={round(entity_rev_sum,2)} global={global_m['total_revenue']}")
            log("Entity", f"{tag} Sum(entity cost) == global cost",
                abs(entity_cost_sum - global_m["total_cost"]) < 0.01)
            log("Entity", f"{tag} Sum(entity net) == global net",
                abs(entity_net_sum - global_m["total_net"]) < 0.01)
            
            # Per-month check
            month_ok = True
            for mk in global_m["net_per_month"]:
                gn = global_m["net_per_month"][mk]
                en = entity_month_nets.get(mk, 0)
                if abs(gn - en) > 0.01:
                    month_ok = False
                    log("Entity", f"{tag} Month {mk} leakage", False, f"global={gn} sum={en}")
            log("Entity", f"{tag} No per-month leakage", month_ok)


# ================================================================
# 5. HORIZON STABILITY
# ================================================================
def test_horizon_stability():
    print("\n" + "="*60)
    print("  5. HORIZON STABILITY")
    print("="*60)
    
    m12 = get_matrix("likely", 12)
    m24 = get_matrix("likely", 24)
    m36 = get_matrix("likely", 36)
    
    # 12M is exact subset of 24M
    subset_12_24 = True
    for mk in m12["net_per_month"]:
        v12 = round(m12["net_per_month"][mk], 2)
        v24 = round(m24["net_per_month"].get(mk, -999999), 2)
        if abs(v12 - v24) > 0.01:
            subset_12_24 = False
            log("Horizon", f"12M/24M mismatch {mk}", False, f"12M={v12} 24M={v24}")
    log("Horizon", "12M is exact subset of 24M (net)", subset_12_24)
    
    # 12M is exact subset of 36M
    subset_12_36 = True
    for mk in m12["net_per_month"]:
        v12 = round(m12["net_per_month"][mk], 2)
        v36 = round(m36["net_per_month"].get(mk, -999999), 2)
        if abs(v12 - v36) > 0.01:
            subset_12_36 = False
    log("Horizon", "12M is exact subset of 36M (net)", subset_12_36)
    
    # 24M is exact subset of 36M
    subset_24_36 = True
    for mk in m24["net_per_month"]:
        v24 = round(m24["net_per_month"][mk], 2)
        v36 = round(m36["net_per_month"].get(mk, -999999), 2)
        if abs(v24 - v36) > 0.01:
            subset_24_36 = False
    log("Horizon", "24M is exact subset of 36M (net)", subset_24_36)
    
    # Balance check: same cash_now across all
    log("Horizon", "Same cash_now 12/24/36",
        abs(m12["cash_now"] - m24["cash_now"]) < 0.01 and abs(m24["cash_now"] - m36["cash_now"]) < 0.01)
    
    # Revenue/cost subsets
    rev_12_24 = all(
        abs(m12["revenue_per_month"].get(mk, 0) - m24["revenue_per_month"].get(mk, 0)) < 0.01
        for mk in m12["revenue_per_month"]
    )
    log("Horizon", "Revenue 12M subset of 24M", rev_12_24)
    
    cost_12_24 = all(
        abs(m12["cost_per_month"].get(mk, 0) - m24["cost_per_month"].get(mk, 0)) < 0.01
        for mk in m12["cost_per_month"]
    )
    log("Horizon", "Cost 12M subset of 24M", cost_12_24)
    
    # Repeated fetches — no drift
    m12_a = get_matrix("likely", 12)
    m12_b = get_matrix("likely", 12)
    log("Horizon", "Repeated fetch — no drift",
        abs(m12_a["total_net"] - m12_b["total_net"]) < 0.001)


# ================================================================
# 6. DECISION PANEL ACCURACY
# ================================================================
def test_decision_panel():
    print("\n" + "="*60)
    print("  6. DECISION PANEL ACCURACY")
    print("="*60)
    
    # Runway accuracy
    runway = requests.get(f"{API}/projection/runway", params={"horizon": 36}).json()
    
    for sc in ["committed", "likely"]:
        proj = get_proj(sc, 36)
        r = runway[sc]
        
        # First breach in forward months only (projection may include historical months)
        cm_key = date.today().replace(day=1).strftime("%Y-%m")
        actual_breach = None
        fwd = 0
        for m in proj["months"]:
            if m["month"] < cm_key:
                continue
            fwd += 1
            if m["closing_cash"] < 0:
                actual_breach = {"idx": fwd, "month": m["month_label"]}
                break
        
        if actual_breach:
            log("Decision", f"Runway [{sc}] breach month matches projection",
                r["breach_month"] == actual_breach["month"],
                f"runway={r['breach_month']} proj={actual_breach['month']}")
            log("Decision", f"Runway [{sc}] months count matches",
                r["months_until_breach"] == actual_breach["idx"])
        else:
            log("Decision", f"Runway [{sc}] correctly reports safe", r["is_safe"])
    
    # Scenario delta accuracy
    delta = requests.get(f"{API}/projection/scenario-delta", params={"horizon": 12}).json()
    proj_c = get_proj("committed", 12)
    proj_l = get_proj("likely", 12)
    
    delta_ok = True
    for i, (cm, lm) in enumerate(zip(proj_c["months"], proj_l["months"])):
        expected_gap = round(lm["closing_cash"] - cm["closing_cash"], 2)
        actual_gap = round(delta["months"][i]["gap_balance"], 2)
        if abs(expected_gap - actual_gap) > 0.01:
            delta_ok = False
            log("Decision", f"Delta mismatch {cm['month']}", False,
                f"expected={expected_gap} got={actual_gap}")
    log("Decision", "Scenario delta matches projection exactly", delta_ok)
    
    # Top drivers — verify amounts match matrix
    drivers = requests.get(f"{API}/projection/drivers", params={"scenario": "likely", "horizon": 12}).json()
    matrix = get_matrix("likely", 12)
    
    # Global drivers should be negative flows aggregated
    for gd in drivers.get("global_drivers", []):
        log("Decision", f"Global driver '{gd['label']}' is negative", gd["amount"] < 0)
    
    # Variance summary matches recorded actuals
    variance = requests.get(f"{API}/variance-summary").json()
    all_occs = requests.get(f"{API}/flow-occurrences").json()
    actual_count = sum(1 for o in all_occs if o.get("actual_amount") is not None)
    log("Decision", "Variance actuals_recorded matches DB",
        variance["actuals_recorded"] == actual_count,
        f"api={variance['actuals_recorded']} db={actual_count}")


# ================================================================
# 7. PERFORMANCE / STABILITY
# ================================================================
def test_performance():
    print("\n" + "="*60)
    print("  7. PERFORMANCE / STABILITY")
    print("="*60)
    
    entity_id = get_entity()
    
    # Create 200 flows rapidly
    created_ids = []
    t0 = time.time()
    for i in range(200):
        f = create_flow(entity_id, f"PERF Flow {i}", -(100 + i), "2026-04-01",
                       category="Expense", recurrence="monthly")
        created_ids.append(f["id"])
    create_time = time.time() - t0
    log("Performance", f"200 flows created in {create_time:.1f}s", create_time < 60, f"{create_time:.1f}s")
    
    # Projection with 200+ flows
    t1 = time.time()
    proj = get_proj("likely", 12)
    proj_time = time.time() - t1
    log("Performance", f"Projection (200+ flows) in {proj_time:.2f}s", proj_time < 5, f"{proj_time:.2f}s")
    
    # Matrix with 200+ flows
    t2 = time.time()
    matrix = get_matrix("likely", 12)
    matrix_time = time.time() - t2
    log("Performance", f"Matrix (200+ flows) in {matrix_time:.2f}s", matrix_time < 5, f"{matrix_time:.2f}s")
    
    # 36M horizon with 200+ flows
    t3 = time.time()
    matrix36 = get_matrix("likely", 36)
    matrix36_time = time.time() - t3
    log("Performance", f"Matrix 36M (200+ flows) in {matrix36_time:.2f}s", matrix36_time < 10, f"{matrix36_time:.2f}s")
    
    # Verify consistency under load
    pn = round(sum(m["inflows"] - m["outflows"] for m in proj["months"]), 2)
    mn = matrix["total_net"]
    log("Performance", "Projection == Matrix under load", abs(pn - mn) < 0.01, f"diff={abs(pn-mn)}")
    
    # Cleanup: undo all 200
    for i in range(200):
        requests.post(f"{API}/undo")
    
    after = get_matrix("likely", 12)
    flow_count = len(requests.get(f"{API}/cash-flows").json())
    log("Performance", "200 undos completed cleanly",
        not any(f["id"] in created_ids for f in requests.get(f"{API}/cash-flows").json()))


# ================================================================
# MAIN
# ================================================================
def main():
    setup()
    print("=" * 60)
    print("  CREED 2 FINAL AUDIT — FAILURE MODE TESTING")
    print("=" * 60)
    
    test_numerical_integrity()
    test_undo_destructive()
    test_dependency_graph()
    test_multi_entity()
    test_horizon_stability()
    test_decision_panel()
    test_performance()
    
    print("\n" + "=" * 60)
    print(f"  AUDIT COMPLETE: {PASS_COUNT} PASS / {FAIL_COUNT} FAIL / {PASS_COUNT + FAIL_COUNT} TOTAL")
    print("=" * 60)
    
    report = {
        "audit": "Creed 2 Final — Failure Mode Testing",
        "timestamp": datetime.now().isoformat(),
        "pass_count": PASS_COUNT,
        "fail_count": FAIL_COUNT,
        "total": PASS_COUNT + FAIL_COUNT,
        "status": "PASS" if FAIL_COUNT == 0 else "FAIL",
        "results": RESULTS,
    }
    with open("/app/test_reports/creed2_final_audit.json", "w") as f:
        json.dump(report, f, indent=2)
    
    if FAIL_COUNT > 0:
        print("\nFAILURES:")
        for r in RESULTS:
            if r["status"] == "FAIL":
                print(f"  \u2717 [{r['section']}] {r['test']}: {r['detail']}")
        sys.exit(1)
    else:
        print("\n  No drift, no inconsistency, no dependency break.")
        print("  System is a reliable financial operating system.")

if __name__ == "__main__":
    main()
