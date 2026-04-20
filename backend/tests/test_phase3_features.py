"""
Cash Piloting Dashboard - Phase 3 Features Backend Tests
Tests for: Matrix endpoint, Actuals & Variance system, Undo system, Entry Log
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://cash-risk-map.preview.emergentagent.com').rstrip('/')

class TestMatrixEndpoint:
    """Tests for /api/projection/matrix - must match projection engine exactly"""
    
    def test_matrix_endpoint_returns_required_fields(self):
        """GET /api/projection/matrix returns revenue_rows, expense_rows, net_per_month, months"""
        response = requests.get(f"{BASE_URL}/api/projection/matrix", params={"scenario": "likely"})
        assert response.status_code == 200
        data = response.json()
        
        assert "months" in data, "Matrix should have months"
        assert "revenue_rows" in data, "Matrix should have revenue_rows"
        assert "expense_rows" in data, "Matrix should have expense_rows"
        assert "net_per_month" in data, "Matrix should have net_per_month"
        
        # Verify months structure
        assert len(data["months"]) > 0
        assert "key" in data["months"][0]
        assert "label" in data["months"][0]
        
    def test_matrix_net_matches_projection_net(self):
        """CRITICAL: Matrix net_per_month values EXACTLY match GET /api/projection months.net values"""
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
                # Allow small floating point tolerance
                if abs(matrix_net - proj_net) > 0.01:
                    mismatches.append(f"{month_key}: matrix={matrix_net}, projection={proj_net}")
        
        assert len(mismatches) == 0, f"Matrix net values don't match projection: {mismatches}"
        
    def test_matrix_with_entity_filter(self):
        """Matrix endpoint respects entity_id filter"""
        # Get entities
        entities_resp = requests.get(f"{BASE_URL}/api/entities")
        entities = entities_resp.json()
        
        if len(entities) > 0:
            entity_id = entities[0]["id"]
            response = requests.get(f"{BASE_URL}/api/projection/matrix", params={
                "scenario": "likely",
                "entity_id": entity_id
            })
            assert response.status_code == 200
            data = response.json()
            assert "net_per_month" in data
            
    def test_matrix_with_different_horizons(self):
        """Matrix endpoint respects horizon parameter"""
        for horizon in [12, 24, 36]:
            response = requests.get(f"{BASE_URL}/api/projection/matrix", params={
                "scenario": "likely",
                "horizon": horizon
            })
            assert response.status_code == 200
            data = response.json()
            assert len(data["months"]) >= horizon + 2, f"Expected at least {horizon + 2} months, got {len(data['months'])}"


class TestActualsAndVariance:
    """Tests for the new Actuals & Variance system (replacing old paid/unpaid/carryover)"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for actuals tests"""
        entity_name = f"TEST_ActualsEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
        
    def test_record_actual_with_carry_forward(self, test_entity):
        """PUT /api/flow-occurrences with actual_amount and variance_action=carry_forward creates carryover"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_ActualCarryForward",
            "amount": -5000,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Record actual with carry_forward (paid 3000 instead of 5000, carry forward 2000)
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-05",
            "actual_amount": -3000,
            "variance_action": "carry_forward"
        })
        assert response.status_code == 200
        
        # Check for carryover flow in next month
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is not None, "Carryover flow should be created for carry_forward"
        assert carryover["carryover_month"] == "2026-05"
        assert "(variance carryover)" in carryover["label"]
        assert carryover["date"].startswith("2026-06")  # Next month
        # Variance = planned (-5000) - actual (-3000) = -2000
        assert carryover["amount"] == -2000, f"Expected -2000 variance, got {carryover['amount']}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        if carryover:
            requests.delete(f"{BASE_URL}/api/cash-flows/{carryover['id']}")
            
    def test_record_actual_with_write_off(self, test_entity):
        """PUT /api/flow-occurrences with actual_amount and variance_action=write_off does NOT create carryover"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_ActualWriteOff",
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
        
    def test_clear_actual_removes_carryover(self, test_entity):
        """DELETE /api/flow-occurrences clears actual and removes carryover"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_ClearActual",
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
        assert carryover is not None
        
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
        
    def test_month_details_returns_actuals_info(self, test_entity):
        """GET /api/month-details returns all_flows with planned_amount, actual_amount, variance_action"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_MonthDetailsActual",
            "amount": -2500,
            "date": "2026-08-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Record actual
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-08",
            "actual_amount": -2000,
            "variance_action": "write_off"
        })
        
        # Get month details
        response = requests.get(f"{BASE_URL}/api/month-details/2026-08", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Find our flow
        flow_in_details = next((f for f in data["all_flows"] if f.get("flow_id") == flow_id), None)
        assert flow_in_details is not None
        
        # Verify actuals info
        assert "planned_amount" in flow_in_details
        assert "actual_amount" in flow_in_details
        assert "variance_action" in flow_in_details
        assert flow_in_details["actual_amount"] == -2000
        assert flow_in_details["variance_action"] == "write_off"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_projection_uses_actual_when_recorded(self, test_entity):
        """Projection engine uses actual_amount when recorded (replaces planned in projection)"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_ProjectionActual",
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


class TestUndoSystem:
    """Tests for the undo system"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for undo tests"""
        entity_name = f"TEST_UndoEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
        
    def test_undo_peek_returns_has_undo_and_description(self):
        """GET /api/undo/peek returns has_undo and description of last action"""
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        assert response.status_code == 200
        data = response.json()
        
        assert "has_undo" in data
        if data["has_undo"]:
            assert "description" in data
            assert "action_type" in data
            
    def test_create_flow_pushes_to_undo_stack(self, test_entity):
        """Creating a flow pushes to undo stack, undo deletes it"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_UndoCreate",
            "amount": -1000,
            "date": "2026-10-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Check undo peek
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        assert response.status_code == 200
        data = response.json()
        assert data["has_undo"] == True
        assert "TEST_UndoCreate" in data["description"]
        assert data["action_type"] == "create"
        
        # Perform undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        assert response.json()["status"] == "undone"
        
        # Verify flow was deleted
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        flow_exists = any(f["id"] == flow_id for f in flows)
        assert not flow_exists, "Flow should be deleted after undo"
        
    def test_edit_flow_pushes_to_undo_stack(self, test_entity):
        """Editing a flow pushes to undo stack, undo restores previous values"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_UndoEdit",
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
        response = requests.put(f"{BASE_URL}/api/cash-flows/{flow_id}", json={
            "amount": -3000
        })
        assert response.status_code == 200
        
        # Check undo peek
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        data = response.json()
        assert data["has_undo"] == True
        assert data["action_type"] == "update"
        
        # Perform undo
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
        
    def test_delete_flow_pushes_to_undo_stack(self, test_entity):
        """Deleting a flow pushes to undo stack, undo restores it"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_UndoDelete",
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
        response = requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        assert response.status_code == 200
        
        # Check undo peek
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        data = response.json()
        assert data["has_undo"] == True
        assert data["action_type"] == "delete"
        
        # Perform undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        
        # Verify flow was restored
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        flow = next((f for f in flows if f["id"] == flow_id), None)
        assert flow is not None, "Flow should be restored after undo"
        assert flow["label"] == "TEST_UndoDelete"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_batch_create_pushes_one_undo_entry(self, test_entity):
        """Batch create pushes one undo entry, undo removes all created flows (parent+children)"""
        # Create batch
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_UndoBatchParent",
                "amount": 10000,
                "date": "2027-01-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "none",
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_UndoBatchChild",
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
        
        # Check undo peek
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        data = response.json()
        assert data["has_undo"] == True
        assert data["action_type"] == "batch_create"
        
        # Perform undo
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        
        # Verify both parent and child were deleted
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        parent_exists = any(f["id"] == parent_id for f in flows)
        child_exists = any(f["id"] == child_id for f in flows)
        
        assert not parent_exists, "Parent should be deleted after undo"
        assert not child_exists, "Child should be deleted after undo"
        
    def test_undo_nothing_returns_nothing_to_undo(self):
        """POST /api/undo when stack is empty returns nothing_to_undo"""
        # Clear undo stack by undoing everything (up to a limit)
        for _ in range(60):  # MAX_UNDO_STACK is 50
            response = requests.post(f"{BASE_URL}/api/undo")
            if response.json().get("status") == "nothing_to_undo":
                break
        
        # Now try to undo again
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        assert response.json()["status"] == "nothing_to_undo"


class TestEntryLogEndpoints:
    """Tests for entry log related endpoints"""
    
    def test_cash_flows_with_linked_returns_grouped_data(self):
        """GET /api/cash-flows/with-linked returns parent/child grouping"""
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            # Each item should have flow and linked_flows
            assert "flow" in data[0]
            assert "linked_flows" in data[0]
            
    def test_cash_flows_with_linked_shows_linked_indicators(self):
        """Entry log shows parent/child grouping with linked flow indicators"""
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked")
        assert response.status_code == 200
        data = response.json()
        
        # Find a flow with linked children
        flow_with_children = next((f for f in data if len(f.get("linked_flows", [])) > 0), None)
        
        if flow_with_children:
            # Verify linked flows have parent_id
            for child in flow_with_children["linked_flows"]:
                assert child.get("parent_id") == flow_with_children["flow"]["id"]


class TestAPIHealth:
    """Basic API health checks for Phase 3 endpoints"""
    
    def test_projection_matrix_endpoint_exists(self):
        """GET /api/projection/matrix endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/projection/matrix")
        assert response.status_code == 200
        
    def test_undo_peek_endpoint_exists(self):
        """GET /api/undo/peek endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/undo/peek")
        assert response.status_code == 200
        
    def test_undo_endpoint_exists(self):
        """POST /api/undo endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/undo")
        assert response.status_code == 200
        
    def test_flow_occurrences_delete_endpoint_exists(self):
        """DELETE /api/flow-occurrences endpoint exists"""
        # This will return 200 even with invalid params
        response = requests.delete(f"{BASE_URL}/api/flow-occurrences", params={
            "flow_id": "nonexistent",
            "month": "2026-01"
        })
        assert response.status_code == 200
