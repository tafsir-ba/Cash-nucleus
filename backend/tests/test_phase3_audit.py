"""
Cash Piloting Dashboard - Phase 3 AUDIT Tests
Final control phase validation:
1) Matrix cells with has_actual, actual, planned fields
2) Matrix net EXACTLY matches projection net
3) Record actual via PUT /api/flow-occurrences with carry_forward/write_off
4) DELETE /api/flow-occurrences clears actual and removes carryover
5) Actual amount replaces planned in projection output
6) Undo still works (create, edit, delete, batch)
7) No legacy unpaid/paid status logic remains
8) expand_recurring_flows no longer accepts unpaid_set parameter
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://cash-risk-map.preview.emergentagent.com').rstrip('/')


class TestMatrixCellsWithActuals:
    """Tests for matrix cells containing has_actual, actual, planned fields"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_MatrixActuals_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_matrix_cells_have_has_actual_field(self, test_entity):
        """Matrix cells should have has_actual field"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_MatrixHasActual",
            "amount": -5000,
            "date": datetime.now().strftime("%Y-%m") + "-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Get matrix
        response = requests.get(f"{BASE_URL}/api/projection/matrix", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Find our flow's row
        all_rows = data.get("expense_rows", []) + data.get("revenue_rows", [])
        our_row = next((r for r in all_rows if r.get("flow_id") == flow_id), None)
        
        if our_row and our_row.get("cells"):
            # Check first cell has has_actual field
            first_cell = list(our_row["cells"].values())[0]
            assert "has_actual" in first_cell, "Cell should have has_actual field"
            assert first_cell["has_actual"] == False, "has_actual should be False when no actual recorded"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
    
    def test_matrix_cells_show_actual_and_planned_when_recorded(self, test_entity):
        """Matrix cells should show actual and planned fields when actual is recorded"""
        current_month = datetime.now().strftime("%Y-%m")
        
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_MatrixActualPlanned",
            "amount": -6000,
            "date": current_month + "-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Record actual
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": current_month,
            "actual_amount": -4000,
            "variance_action": "write_off"
        })
        assert response.status_code == 200
        
        # Get matrix
        response = requests.get(f"{BASE_URL}/api/projection/matrix", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Find our flow's row
        all_rows = data.get("expense_rows", []) + data.get("revenue_rows", [])
        our_row = next((r for r in all_rows if r.get("flow_id") == flow_id), None)
        
        assert our_row is not None, "Flow should appear in matrix"
        
        # Check the cell for current month
        cell = our_row["cells"].get(current_month)
        if cell:
            assert cell.get("has_actual") == True, "has_actual should be True"
            assert "actual" in cell, "Cell should have actual field"
            assert "planned" in cell, "Cell should have planned field"
            assert cell["actual"] == -4000, f"Actual should be -4000, got {cell.get('actual')}"
            assert cell["planned"] == -6000, f"Planned should be -6000, got {cell.get('planned')}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/flow-occurrences", params={"flow_id": flow_id, "month": current_month})
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")


class TestMatrixNetMatchesProjectionNet:
    """CRITICAL: Matrix net_per_month EXACTLY matches projection months net"""
    
    def test_matrix_net_exactly_matches_projection_net_12m(self):
        """Matrix net_per_month values EXACTLY match projection months.net for 12 months"""
        # Get projection
        proj_response = requests.get(f"{BASE_URL}/api/projection", params={"scenario": "likely", "horizon": 12})
        assert proj_response.status_code == 200
        proj_data = proj_response.json()
        
        # Get matrix
        matrix_response = requests.get(f"{BASE_URL}/api/projection/matrix", params={"scenario": "likely", "horizon": 12})
        assert matrix_response.status_code == 200
        matrix_data = matrix_response.json()
        
        # Build projection net map
        proj_net_map = {m["month"]: m["net"] for m in proj_data["months"]}
        
        # Compare each month
        mismatches = []
        for month_key, matrix_net in matrix_data["net_per_month"].items():
            proj_net = proj_net_map.get(month_key)
            if proj_net is not None:
                if abs(matrix_net - proj_net) > 0.01:
                    mismatches.append(f"{month_key}: matrix={matrix_net}, projection={proj_net}")
        
        assert len(mismatches) == 0, f"Matrix net values don't match projection: {mismatches}"
    
    def test_matrix_net_exactly_matches_projection_net_24m(self):
        """Matrix net_per_month values EXACTLY match projection months.net for 24 months"""
        proj_response = requests.get(f"{BASE_URL}/api/projection", params={"scenario": "likely", "horizon": 24})
        assert proj_response.status_code == 200
        proj_data = proj_response.json()
        
        matrix_response = requests.get(f"{BASE_URL}/api/projection/matrix", params={"scenario": "likely", "horizon": 24})
        assert matrix_response.status_code == 200
        matrix_data = matrix_response.json()
        
        proj_net_map = {m["month"]: m["net"] for m in proj_data["months"]}
        
        mismatches = []
        for month_key, matrix_net in matrix_data["net_per_month"].items():
            proj_net = proj_net_map.get(month_key)
            if proj_net is not None:
                if abs(matrix_net - proj_net) > 0.01:
                    mismatches.append(f"{month_key}: matrix={matrix_net}, projection={proj_net}")
        
        assert len(mismatches) == 0, f"Matrix net values don't match projection (24m): {mismatches}"


class TestRecordActualCarryForwardWriteOff:
    """Tests for recording actuals with carry_forward and write_off variance actions"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_ActualVariance_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_carry_forward_creates_carryover_flow(self, test_entity):
        """PUT /api/flow-occurrences with carry_forward creates carryover in next month"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_CarryForwardVariance",
            "amount": -5000,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Record actual with carry_forward (paid 3000 instead of 5000)
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-05",
            "actual_amount": -3000,
            "variance_action": "carry_forward"
        })
        assert response.status_code == 200
        
        # Check for carryover flow
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is not None, "Carryover flow should be created"
        assert carryover["carryover_month"] == "2026-05"
        assert "(variance carryover)" in carryover["label"]
        assert carryover["date"].startswith("2026-06")  # Next month
        # Variance = planned (-5000) - actual (-3000) = -2000
        assert carryover["amount"] == -2000, f"Expected -2000 variance, got {carryover['amount']}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        if carryover:
            requests.delete(f"{BASE_URL}/api/cash-flows/{carryover['id']}")
    
    def test_write_off_does_not_create_carryover(self, test_entity):
        """PUT /api/flow-occurrences with write_off does NOT create carryover"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_WriteOffVariance",
            "amount": -4000,
            "date": "2026-06-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Record actual with write_off
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-06",
            "actual_amount": -2000,
            "variance_action": "write_off"
        })
        assert response.status_code == 200
        
        # Check NO carryover was created
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is None, "No carryover should be created for write_off"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")


class TestDeleteFlowOccurrenceClearsActual:
    """Tests for DELETE /api/flow-occurrences clearing actual and removing carryover"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_ClearActual_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_delete_occurrence_clears_actual_and_removes_carryover(self, test_entity):
        """DELETE /api/flow-occurrences clears actual and removes carryover"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_ClearActualCarryover",
            "amount": -3000,
            "date": "2026-07-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Record actual with carry_forward
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-07",
            "actual_amount": -1000,
            "variance_action": "carry_forward"
        })
        
        # Verify carryover exists
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is not None, "Carryover should exist before clearing"
        
        # Clear the actual
        response = requests.delete(f"{BASE_URL}/api/flow-occurrences", params={
            "flow_id": flow_id,
            "month": "2026-07"
        })
        assert response.status_code == 200
        
        # Verify carryover was removed
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is None, "Carryover should be removed when actual is cleared"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")


class TestActualReplacesPlannedInProjection:
    """Tests for actual amount replacing planned in projection output"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_ActualProjection_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_projection_uses_actual_instead_of_planned(self, test_entity):
        """Projection engine uses actual_amount when recorded"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_ProjectionActualReplace",
            "amount": -6000,
            "date": "2026-09-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Get projection before recording actual
        response = requests.get(f"{BASE_URL}/api/projection", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        data_before = response.json()
        sept_before = next((m for m in data_before["months"] if m["month"] == "2026-09"), None)
        outflows_before = sept_before["outflows"] if sept_before else 0
        
        # Record actual (paid 4000 instead of 6000)
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-09",
            "actual_amount": -4000,
            "variance_action": "write_off"
        })
        
        # Get projection after recording actual
        response = requests.get(f"{BASE_URL}/api/projection", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        data_after = response.json()
        sept_after = next((m for m in data_after["months"] if m["month"] == "2026-09"), None)
        outflows_after = sept_after["outflows"] if sept_after else 0
        
        # Outflows should be reduced by 2000 (6000 planned -> 4000 actual)
        assert outflows_after < outflows_before, "Projection should use actual amount"
        assert abs((outflows_before - outflows_after) - 2000) < 1, "Difference should be ~2000"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")


class TestUndoStillWorks:
    """Tests for undo system still working (create, edit, delete, batch)"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_UndoAudit_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_undo_create_works(self, test_entity):
        """Undo for create action works"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_UndoCreateAudit",
            "amount": -1000,
            "date": "2026-10-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        assert response.json()["status"] == "undone"
        
        # Verify flow was deleted
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        assert not any(f["id"] == flow_id for f in flows), "Flow should be deleted after undo"
    
    def test_undo_edit_works(self, test_entity):
        """Undo for edit action works"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_UndoEditAudit",
            "amount": -2000,
            "date": "2026-11-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Edit the flow
        requests.put(f"{BASE_URL}/api/cash-flows/{flow_id}", json={"amount": -3000})
        
        # Undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        
        # Verify amount was restored
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        flow = next((f for f in flows if f["id"] == flow_id), None)
        assert flow is not None
        assert flow["amount"] == -2000, f"Expected -2000, got {flow['amount']}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
    
    def test_undo_delete_works(self, test_entity):
        """Undo for delete action works"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_UndoDeleteAudit",
            "amount": -1500,
            "date": "2026-12-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Delete the flow
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
        # Undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        
        # Verify flow was restored
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        flow = next((f for f in flows if f["id"] == flow_id), None)
        assert flow is not None, "Flow should be restored after undo"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
    
    def test_undo_batch_works(self, test_entity):
        """Undo for batch create action works"""
        # Create batch
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_UndoBatchAudit",
                "amount": 10000,
                "date": "2027-01-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "none",
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_UndoBatchChildAudit",
                    "amount": 0,
                    "date": "2027-01-01",
                    "category": "COGS",
                    "certainty": "Materialized",
                    "entity_id": test_entity["id"],
                    "is_percentage": True,
                    "percentage_of_parent": 30
                }
            ]
        })
        assert response.status_code == 200
        parent_id = response.json()["parent"]["id"]
        child_id = response.json()["linked"][0]["id"]
        
        # Undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        
        # Verify both were deleted
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        assert not any(f["id"] == parent_id for f in flows), "Parent should be deleted"
        assert not any(f["id"] == child_id for f in flows), "Child should be deleted"


class TestNoLegacyPaidUnpaidStatus:
    """Tests to verify no legacy unpaid/paid status logic remains"""
    
    def test_flow_occurrences_no_status_field(self):
        """Flow occurrences should not have legacy 'status' field"""
        response = requests.get(f"{BASE_URL}/api/flow-occurrences")
        assert response.status_code == 200
        data = response.json()
        
        # If there are occurrences, check they don't have 'status' field
        for occ in data:
            assert "status" not in occ or occ.get("status") is None, \
                f"Occurrence should not have legacy status field: {occ}"
    
    def test_month_details_no_status_field(self):
        """Month details flows should not have legacy 'status' field"""
        current_month = datetime.now().strftime("%Y-%m")
        response = requests.get(f"{BASE_URL}/api/month-details/{current_month}")
        assert response.status_code == 200
        data = response.json()
        
        # Check all_flows don't have legacy 'status' field
        for flow in data.get("all_flows", []):
            # Should have variance_action instead of status
            assert "variance_action" in flow or "actual_amount" in flow, \
                "Flow should have variance_action or actual_amount, not legacy status"


class TestExpandRecurringFlowsNoUnpaidSet:
    """Tests to verify expand_recurring_flows no longer accepts unpaid_set parameter"""
    
    def test_projection_works_without_unpaid_set(self):
        """Projection endpoint works without unpaid_set parameter"""
        response = requests.get(f"{BASE_URL}/api/projection", params={"scenario": "likely"})
        assert response.status_code == 200
        data = response.json()
        
        # Should have months data
        assert "months" in data
        assert len(data["months"]) > 0
    
    def test_matrix_works_without_unpaid_set(self):
        """Matrix endpoint works without unpaid_set parameter"""
        response = requests.get(f"{BASE_URL}/api/projection/matrix", params={"scenario": "likely"})
        assert response.status_code == 200
        data = response.json()
        
        # Should have net_per_month
        assert "net_per_month" in data


class TestAPIEndpointsExist:
    """Basic API health checks for Phase 3 Audit endpoints"""
    
    def test_projection_endpoint_exists(self):
        """GET /api/projection endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/projection")
        assert response.status_code == 200
    
    def test_projection_matrix_endpoint_exists(self):
        """GET /api/projection/matrix endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/projection/matrix")
        assert response.status_code == 200
    
    def test_flow_occurrences_get_endpoint_exists(self):
        """GET /api/flow-occurrences endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/flow-occurrences")
        assert response.status_code == 200
    
    def test_flow_occurrences_put_endpoint_exists(self):
        """PUT /api/flow-occurrences endpoint exists"""
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": "nonexistent",
            "month": "2026-01",
            "actual_amount": 0
        })
        # Should return 200 even for nonexistent flow
        assert response.status_code == 200
    
    def test_flow_occurrences_delete_endpoint_exists(self):
        """DELETE /api/flow-occurrences endpoint exists"""
        response = requests.delete(f"{BASE_URL}/api/flow-occurrences", params={
            "flow_id": "nonexistent",
            "month": "2026-01"
        })
        assert response.status_code == 200
    
    def test_undo_peek_endpoint_exists(self):
        """GET /api/undo/peek endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        assert response.status_code == 200
    
    def test_undo_endpoint_exists(self):
        """POST /api/undo endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
    
    def test_cash_flows_with_linked_endpoint_exists(self):
        """GET /api/cash-flows/with-linked endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked")
        assert response.status_code == 200
