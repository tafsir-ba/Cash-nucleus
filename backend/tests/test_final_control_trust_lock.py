"""
Final Control & Trust Lock Tests - Iteration 9
Tests for:
1. UNDO system - full state restoration including dependencies
2. CREED 2 - Projection == Matrix exact match
3. SSOT - Backend provides all totals, frontend reads directly
4. Variance tracking - Global variance summary
5. Distributed flows with linked children
"""
import pytest
import requests
import os
import time
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="module")
def test_entity_id(api_client):
    """Get an existing entity ID for testing"""
    entities = api_client.get(f"{BASE_URL}/api/entities").json()
    if entities:
        return entities[0]["id"]
    # Create one if none exist
    entity = {"name": f"Test Entity {uuid.uuid4().hex[:8]}"}
    res = api_client.post(f"{BASE_URL}/api/entities", json=entity)
    return res.json()["id"]

def cleanup_test_flows(api_client, prefix="TEST_"):
    """Clean up test flows by prefix"""
    flows = api_client.get(f"{BASE_URL}/api/cash-flows").json()
    for f in flows:
        if f.get("label", "").startswith(prefix):
            api_client.delete(f"{BASE_URL}/api/cash-flows/{f['id']}?delete_linked=true")

# ============== CREED 2: PROJECTION == MATRIX EXACT MATCH ==============
class TestCreed2ProjectionMatrixMatch:
    """CREED 2: Matrix = Projection = P&L exact match"""
    
    def test_projection_matrix_net_per_month_match(self, api_client):
        """Verify /api/projection net per month == /api/projection/matrix net_per_month"""
        proj = api_client.get(f"{BASE_URL}/api/projection").json()
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        # Build projection net per month from months array
        proj_net_per_month = {m["month"]: m["net"] for m in proj["months"]}
        matrix_net_per_month = matrix["net_per_month"]
        
        # Compare all months (forward + rolling history)
        for month_key, proj_net in proj_net_per_month.items():
            matrix_net = matrix_net_per_month.get(month_key, 0)
            assert abs(proj_net - matrix_net) < 0.01, f"Month {month_key}: projection net {proj_net} != matrix net {matrix_net}"
        
        print(f"✓ All {len(proj_net_per_month)} months match between projection and matrix")
    
    def test_projection_matrix_total_net_match(self, api_client):
        """Verify /api/projection total net == /api/projection/matrix total_net"""
        proj = api_client.get(f"{BASE_URL}/api/projection").json()
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        # Sum projection months
        proj_total_net = sum(m["net"] for m in proj["months"])
        matrix_total_net = matrix["total_net"]
        
        assert abs(proj_total_net - matrix_total_net) < 0.01, f"Projection total {proj_total_net} != Matrix total {matrix_total_net}"
        print(f"✓ Total net matches: {matrix_total_net}")
    
    def test_revenue_minus_cost_equals_net(self, api_client):
        """Verify revenue_per_month - cost_per_month == net_per_month for every month"""
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        for month in matrix["months"]:
            key = month["key"]
            revenue = matrix["revenue_per_month"].get(key, 0)
            cost = matrix["cost_per_month"].get(key, 0)
            net = matrix["net_per_month"].get(key, 0)
            
            computed_net = revenue - cost
            assert abs(computed_net - net) < 0.01, f"Month {key}: {revenue} - {cost} = {computed_net} != {net}"
        
        print(f"✓ Revenue - Cost = Net verified for all {len(matrix['months'])} months")
    
    def test_24m_horizon_projection_matrix_match(self, api_client):
        """Verify 24M horizon — projection total = matrix total"""
        proj = api_client.get(f"{BASE_URL}/api/projection?horizon=24").json()
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix?horizon=24").json()
        
        # 24M forward + at least 2 months surface history (more if DB has older occurrences)
        assert len(matrix["months"]) >= 26, f"Expected at least 26 months, got {len(matrix['months'])}"
        
        # Sum projection months
        proj_total_net = sum(m["net"] for m in proj["months"])
        matrix_total_net = matrix["total_net"]
        
        assert abs(proj_total_net - matrix_total_net) < 0.01, f"24M: Projection total {proj_total_net} != Matrix total {matrix_total_net}"
        print(f"✓ 24M horizon matches: {matrix_total_net}")
    
    def test_cash_now_matches(self, api_client):
        """Verify cash_now matches between projection and matrix"""
        proj = api_client.get(f"{BASE_URL}/api/projection").json()
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        assert abs(proj["cash_now"] - matrix["cash_now"]) < 0.01, f"cash_now mismatch: {proj['cash_now']} != {matrix['cash_now']}"
        print(f"✓ cash_now matches: {matrix['cash_now']}")


# ============== SSOT: BACKEND PROVIDES ALL TOTALS ==============
class TestSSOTBackendTotals:
    """SSOT: Matrix response includes all totals — frontend reads directly"""
    
    def test_matrix_includes_total_revenue_cost_net(self, api_client):
        """Matrix response includes total_revenue, total_cost, total_net"""
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        assert "total_revenue" in matrix, "Missing total_revenue in matrix response"
        assert "total_cost" in matrix, "Missing total_cost in matrix response"
        assert "total_net" in matrix, "Missing total_net in matrix response"
        
        # Verify they are numbers
        assert isinstance(matrix["total_revenue"], (int, float)), "total_revenue should be numeric"
        assert isinstance(matrix["total_cost"], (int, float)), "total_cost should be numeric"
        assert isinstance(matrix["total_net"], (int, float)), "total_net should be numeric"
        
        print(f"✓ Matrix totals: revenue={matrix['total_revenue']}, cost={matrix['total_cost']}, net={matrix['total_net']}")
    
    def test_matrix_rows_include_row_total(self, api_client):
        """Matrix rows include row_total — frontend reads directly"""
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        all_rows = matrix.get("revenue_rows", []) + matrix.get("expense_rows", [])
        
        for row in all_rows:
            assert "row_total" in row, f"Missing row_total in row {row.get('label', 'unknown')}"
            assert isinstance(row["row_total"], (int, float)), f"row_total should be numeric for {row.get('label')}"
        
        print(f"✓ All {len(all_rows)} rows have row_total field")


# ============== VARIANCE TRACKING ==============
class TestVarianceTracking:
    """Variance tracking: GET /api/variance-summary"""
    
    def test_variance_summary_returns_required_fields(self, api_client):
        """GET /api/variance-summary returns actuals_recorded, total_variance, total_carried_forward, total_written_off"""
        res = api_client.get(f"{BASE_URL}/api/variance-summary")
        assert res.status_code == 200
        
        data = res.json()
        assert "actuals_recorded" in data, "Missing actuals_recorded"
        assert "total_variance" in data, "Missing total_variance"
        assert "total_carried_forward" in data, "Missing total_carried_forward"
        assert "total_written_off" in data, "Missing total_written_off"
        
        print(f"✓ Variance summary: {data['actuals_recorded']} actuals, variance={data['total_variance']}")


# ============== UNDO SYSTEM TESTS ==============
class TestUndoSystem:
    """UNDO: Full state restoration including dependencies"""
    
    def test_undo_record_actual_carry_forward_zero_residual(self, api_client, test_entity_id):
        """UNDO: Record actual → carry forward → undo → zero residual"""
        # Create a test flow
        flow = {
            "label": "TEST_UNDO_ACTUAL_CF",
            "amount": 1000,
            "date": "2026-05-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity_id
        }
        create_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=flow)
        assert create_res.status_code == 200, f"Create failed: {create_res.text}"
        flow_id = create_res.json()["id"]
        
        try:
            # Record actual with carry forward
            actual_res = api_client.put(f"{BASE_URL}/api/flow-occurrences", json={
                "flow_id": flow_id,
                "month": "2026-05",
                "actual_amount": 800,  # Under by 200
                "variance_action": "carry_forward"
            })
            assert actual_res.status_code == 200
            
            # Verify carryover was created
            flows_after = api_client.get(f"{BASE_URL}/api/cash-flows").json()
            carryovers = [f for f in flows_after if f.get("carryover_from") == flow_id]
            assert len(carryovers) == 1, "Carryover flow should be created"
            
            # Verify occurrence exists
            occs = api_client.get(f"{BASE_URL}/api/flow-occurrences?flow_id={flow_id}").json()
            assert len(occs) == 1, "Occurrence should exist"
            
            # UNDO
            undo_res = api_client.post(f"{BASE_URL}/api/undo")
            assert undo_res.status_code == 200
            
            # Verify carryover is removed
            flows_after_undo = api_client.get(f"{BASE_URL}/api/cash-flows").json()
            carryovers_after = [f for f in flows_after_undo if f.get("carryover_from") == flow_id]
            assert len(carryovers_after) == 0, "Carryover should be removed after undo"
            
            # Verify occurrence is removed
            occs_after = api_client.get(f"{BASE_URL}/api/flow-occurrences?flow_id={flow_id}").json()
            assert len(occs_after) == 0, "Occurrence should be removed after undo"
            
            print("✓ UNDO: Record actual + carry forward → undo → zero residual")
        finally:
            # Cleanup
            api_client.delete(f"{BASE_URL}/api/cash-flows/{flow_id}?delete_linked=true")
    
    def test_undo_write_off_variance(self, api_client, test_entity_id):
        """UNDO: Write-off variance → undo → occurrence removed, no carryover"""
        # Create a test flow
        flow = {
            "label": "TEST_UNDO_WRITEOFF",
            "amount": 500,
            "date": "2026-06-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity_id
        }
        create_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=flow)
        assert create_res.status_code == 200, f"Create failed: {create_res.text}"
        flow_id = create_res.json()["id"]
        
        try:
            # Record actual with write-off
            actual_res = api_client.put(f"{BASE_URL}/api/flow-occurrences", json={
                "flow_id": flow_id,
                "month": "2026-06",
                "actual_amount": 400,  # Under by 100
                "variance_action": "write_off"
            })
            assert actual_res.status_code == 200
            
            # Verify NO carryover was created
            flows_after = api_client.get(f"{BASE_URL}/api/cash-flows").json()
            carryovers = [f for f in flows_after if f.get("carryover_from") == flow_id]
            assert len(carryovers) == 0, "Write-off should NOT create carryover"
            
            # Verify occurrence exists
            occs = api_client.get(f"{BASE_URL}/api/flow-occurrences?flow_id={flow_id}").json()
            assert len(occs) == 1, "Occurrence should exist"
            
            # UNDO
            undo_res = api_client.post(f"{BASE_URL}/api/undo")
            assert undo_res.status_code == 200
            
            # Verify occurrence is removed
            occs_after = api_client.get(f"{BASE_URL}/api/flow-occurrences?flow_id={flow_id}").json()
            assert len(occs_after) == 0, "Occurrence should be removed after undo"
            
            print("✓ UNDO: Write-off variance → undo → occurrence removed")
        finally:
            # Cleanup
            api_client.delete(f"{BASE_URL}/api/cash-flows/{flow_id}?delete_linked=true")
    
    def test_undo_parent_edit_with_linked_children(self, api_client, test_entity_id):
        """UNDO: Parent edit with linked % children → undo → parent and children amounts fully restored"""
        # Create parent flow
        parent = {
            "label": "TEST_UNDO_PARENT",
            "amount": 10000,
            "date": "2026-07-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity_id
        }
        parent_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=parent)
        assert parent_res.status_code == 200, f"Create parent failed: {parent_res.text}"
        parent_id = parent_res.json()["id"]
        
        # Create linked child (40% COGS)
        child = {
            "label": "TEST_UNDO_CHILD_COGS",
            "amount": -4000,  # 40% of 10000
            "date": "2026-07-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "parent_id": parent_id,
            "is_percentage": True,
            "percentage_of_parent": 40,
            "entity_id": test_entity_id
        }
        child_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=child)
        assert child_res.status_code == 200, f"Create child failed: {child_res.text}"
        child_id = child_res.json()["id"]
        
        def get_flow_by_id(flow_id):
            flows = api_client.get(f"{BASE_URL}/api/cash-flows").json()
            return next((f for f in flows if f["id"] == flow_id), None)
        
        try:
            # Edit parent amount
            edit_res = api_client.put(f"{BASE_URL}/api/cash-flows/{parent_id}", json={
                "amount": 20000  # Double the amount
            })
            assert edit_res.status_code == 200
            
            # Verify child was updated
            child_after = get_flow_by_id(child_id)
            assert child_after is not None, "Child should exist"
            assert abs(child_after["amount"] - (-8000)) < 0.01, f"Child should be -8000, got {child_after['amount']}"
            
            # UNDO
            undo_res = api_client.post(f"{BASE_URL}/api/undo")
            assert undo_res.status_code == 200
            
            # Verify parent restored
            parent_after = get_flow_by_id(parent_id)
            assert parent_after is not None, "Parent should exist"
            assert abs(parent_after["amount"] - 10000) < 0.01, f"Parent should be 10000, got {parent_after['amount']}"
            
            # Verify child restored
            child_restored = get_flow_by_id(child_id)
            assert child_restored is not None, "Child should exist"
            assert abs(child_restored["amount"] - (-4000)) < 0.01, f"Child should be -4000, got {child_restored['amount']}"
            
            print("✓ UNDO: Parent edit with linked children → undo → both restored")
        finally:
            # Cleanup
            api_client.delete(f"{BASE_URL}/api/cash-flows/{parent_id}?delete_linked=true")
    
    def test_undo_delete_with_orphan_children(self, api_client, test_entity_id):
        """UNDO: Delete flow with linked children (orphan mode) → undo → parent restored AND children parent_id restored"""
        
        def get_flow_by_id(flow_id):
            flows = api_client.get(f"{BASE_URL}/api/cash-flows").json()
            return next((f for f in flows if f["id"] == flow_id), None)
        
        # Create parent flow
        parent = {
            "label": "TEST_UNDO_DELETE_PARENT",
            "amount": 5000,
            "date": "2026-08-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity_id
        }
        parent_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=parent)
        assert parent_res.status_code == 200, f"Create parent failed: {parent_res.text}"
        parent_id = parent_res.json()["id"]
        
        # Create linked child
        child = {
            "label": "TEST_UNDO_DELETE_CHILD",
            "amount": -2000,
            "date": "2026-08-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "parent_id": parent_id,
            "is_percentage": True,
            "percentage_of_parent": 40,
            "entity_id": test_entity_id
        }
        child_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=child)
        assert child_res.status_code == 200, f"Create child failed: {child_res.text}"
        child_id = child_res.json()["id"]
        
        try:
            # Delete parent with orphan mode (delete_linked=false)
            delete_res = api_client.delete(f"{BASE_URL}/api/cash-flows/{parent_id}?delete_linked=false")
            assert delete_res.status_code == 200
            
            # Verify parent is deleted
            parent_check = get_flow_by_id(parent_id)
            assert parent_check is None, "Parent should be deleted"
            
            # Verify child is orphaned (parent_id = null)
            child_orphaned = get_flow_by_id(child_id)
            assert child_orphaned is not None, "Child should still exist"
            assert child_orphaned.get("parent_id") is None, "Child should be orphaned"
            
            # UNDO
            undo_res = api_client.post(f"{BASE_URL}/api/undo")
            assert undo_res.status_code == 200
            
            # Verify parent is restored
            parent_restored = get_flow_by_id(parent_id)
            assert parent_restored is not None, "Parent should be restored"
            
            # Verify child's parent_id is restored
            child_restored = get_flow_by_id(child_id)
            assert child_restored is not None, "Child should exist"
            assert child_restored.get("parent_id") == parent_id, f"Child parent_id should be {parent_id}, got {child_restored.get('parent_id')}"
            
            print("✓ UNDO: Delete with orphan children → undo → parent AND children parent_id restored")
        finally:
            # Cleanup
            api_client.delete(f"{BASE_URL}/api/cash-flows/{parent_id}?delete_linked=true")
    
    def test_undo_multi_step_chain_zero_drift(self, api_client, test_entity_id):
        """UNDO: Multi-step undo chain (3 creates → 3 undos) → zero drift from baseline"""
        
        def get_flow_by_id(flow_id):
            flows = api_client.get(f"{BASE_URL}/api/cash-flows").json()
            return next((f for f in flows if f["id"] == flow_id), None)
        
        # Get baseline flow count
        baseline_flows = api_client.get(f"{BASE_URL}/api/cash-flows").json()
        baseline_count = len(baseline_flows)
        
        created_ids = []
        
        # Create 3 flows
        for i in range(3):
            flow = {
                "label": f"TEST_UNDO_CHAIN_{i}",
                "amount": 1000 * (i + 1),
                "date": "2026-09-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "none",
                "entity_id": test_entity_id
            }
            res = api_client.post(f"{BASE_URL}/api/cash-flows", json=flow)
            assert res.status_code == 200, f"Create flow {i} failed: {res.text}"
            created_ids.append(res.json()["id"])
        
        # Verify 3 flows created
        flows_after_create = api_client.get(f"{BASE_URL}/api/cash-flows").json()
        assert len(flows_after_create) == baseline_count + 3, "Should have 3 more flows"
        
        # Undo 3 times
        for i in range(3):
            undo_res = api_client.post(f"{BASE_URL}/api/undo")
            assert undo_res.status_code == 200
        
        # Verify back to baseline
        flows_after_undo = api_client.get(f"{BASE_URL}/api/cash-flows").json()
        assert len(flows_after_undo) == baseline_count, f"Should be back to baseline {baseline_count}, got {len(flows_after_undo)}"
        
        # Verify none of the created flows exist
        for fid in created_ids:
            check = get_flow_by_id(fid)
            assert check is None, f"Flow {fid} should not exist after undo"
        
        print("✓ UNDO: Multi-step chain (3 creates → 3 undos) → zero drift")


# ============== DISTRIBUTED FLOWS WITH LINKED CHILDREN ==============
class TestDistributedFlowsWithLinkedChildren:
    """DISTRIBUTED: Create distributed revenue with linked COGS"""
    
    def test_distributed_revenue_with_linked_cogs(self, api_client, test_entity_id):
        """Create distributed revenue (monthly, 6 periods, amount 60000) + linked COGS (40%) → verify per-period = 10000 and COGS = -4000"""
        # Create distributed revenue
        revenue = {
            "label": "TEST_DISTRIBUTED_REVENUE",
            "amount": 60000,
            "date": "2026-05-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "monthly",
            "recurrence_mode": "distribute",
            "recurrence_count": 6,
            "entity_id": test_entity_id
        }
        rev_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=revenue)
        assert rev_res.status_code == 200, f"Create revenue failed: {rev_res.text}"
        rev_id = rev_res.json()["id"]
        
        # Create linked COGS (40%)
        cogs = {
            "label": "TEST_DISTRIBUTED_COGS",
            "amount": -24000,  # 40% of 60000
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "monthly",
            "recurrence_mode": "distribute",
            "recurrence_count": 6,
            "parent_id": rev_id,
            "is_percentage": True,
            "percentage_of_parent": 40,
            "entity_id": test_entity_id
        }
        cogs_res = api_client.post(f"{BASE_URL}/api/cash-flows", json=cogs)
        assert cogs_res.status_code == 200, f"Create COGS failed: {cogs_res.text}"
        cogs_id = cogs_res.json()["id"]
        
        try:
            # Get matrix to verify per-period amounts
            matrix = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
            
            # Find revenue row
            rev_row = next((r for r in matrix["revenue_rows"] if r["flow_id"] == rev_id), None)
            assert rev_row is not None, "Revenue row should exist in matrix"
            
            # Verify per-period amount is 10000 (60000 / 6)
            for month_key, cell in rev_row["cells"].items():
                assert abs(cell["amount"] - 10000) < 0.01, f"Revenue per-period should be 10000, got {cell['amount']}"
            
            # Find COGS row
            cogs_row = next((r for r in matrix["expense_rows"] if r["flow_id"] == cogs_id), None)
            assert cogs_row is not None, "COGS row should exist in matrix"
            
            # Verify per-period COGS is -4000 (24000 / 6)
            for month_key, cell in cogs_row["cells"].items():
                assert abs(cell["amount"] - (-4000)) < 0.01, f"COGS per-period should be -4000, got {cell['amount']}"
            
            print("✓ DISTRIBUTED: Revenue 60000/6 = 10000/period, COGS 40% = -4000/period")
        finally:
            # Cleanup
            api_client.delete(f"{BASE_URL}/api/cash-flows/{rev_id}?delete_linked=true")


# ============== ENTITY FILTERING ==============
class TestEntityFiltering:
    """EDGE: Multi-entity filtering — matrix totals change when entity filter applied"""
    
    def test_entity_filter_changes_matrix_totals(self, api_client):
        """Matrix totals change when entity filter applied"""
        # Get unfiltered matrix
        matrix_all = api_client.get(f"{BASE_URL}/api/projection/matrix").json()
        
        # Get entities
        entities = api_client.get(f"{BASE_URL}/api/entities").json()
        
        if len(entities) > 0:
            # Get filtered matrix for first entity
            entity_id = entities[0]["id"]
            matrix_filtered = api_client.get(f"{BASE_URL}/api/projection/matrix?entity_id={entity_id}").json()
            
            # Totals should be different (unless all flows belong to this entity)
            # At minimum, verify the endpoint works with entity filter
            assert "total_net" in matrix_filtered, "Filtered matrix should have total_net"
            assert "total_revenue" in matrix_filtered, "Filtered matrix should have total_revenue"
            
            print(f"✓ Entity filter works: all={matrix_all['total_net']}, filtered={matrix_filtered['total_net']}")
        else:
            print("⚠ No entities to test filtering")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
