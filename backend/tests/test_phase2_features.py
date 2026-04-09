"""
Cash Piloting Dashboard - Phase 2 Features Backend Tests
Tests for: Recurrence Mode (Repeat/Distribute), Flow Status + Carryover, Month Details with status
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://cash-risk-map.preview.emergentagent.com').rstrip('/')


class TestDistributeMode:
    """Tests for recurrence_mode=distribute feature"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for distribute mode tests"""
        entity_name = f"TEST_DistEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_batch_create_with_distribute_mode(self, test_entity):
        """POST /api/cash-flows/batch with recurrence_mode=distribute creates correct flow"""
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_DistributeRevenue",
                "amount": 36000,
                "date": "2026-01-01",
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "distribute",
                "recurrence_count": 6,
                "entity_id": test_entity["id"]
            },
            "linked": []
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify parent has distribute mode
        assert data["parent"]["recurrence_mode"] == "distribute"
        assert data["parent"]["recurrence_count"] == 6
        assert data["parent"]["amount"] == 36000
        
    def test_projection_distributes_amounts_across_periods(self, test_entity):
        """GET /api/projection correctly distributes amounts (total/count per period)"""
        # Create a distribute flow: 36000 over 6 months = 6000/month
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_DistProjection",
            "amount": 36000,
            "date": "2026-01-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "recurrence": "monthly",
            "recurrence_mode": "distribute",
            "recurrence_count": 6,
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Get projection
        response = requests.get(f"{BASE_URL}/api/projection", params={
            "entity_id": test_entity["id"],
            "scenario": "committed",
            "horizon": 12
        })
        assert response.status_code == 200
        data = response.json()
        
        # Find months with inflows - should be 6000 per month for 6 months
        months_with_inflows = [m for m in data["months"] if m["inflows"] > 0]
        
        # Verify distribution: 36000 / 6 = 6000 per period
        expected_per_period = 6000.0
        for month in months_with_inflows[:6]:
            # Allow for rounding on last period
            assert abs(month["inflows"] - expected_per_period) <= 1, f"Expected ~{expected_per_period}, got {month['inflows']}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_distribute_mode_last_period_rounding(self, test_entity):
        """Distribute mode handles rounding correctly on last period"""
        # Create a flow that doesn't divide evenly: 10000 / 3 = 3333.33...
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_DistRounding",
            "amount": 10000,
            "date": "2026-01-01",
            "category": "Revenue",
            "certainty": "Materialized",  # Use Materialized for committed scenario
            "recurrence": "monthly",
            "recurrence_mode": "distribute",
            "recurrence_count": 3,
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Get month details for each of the 3 months to verify distribution
        total_distributed = 0
        for month in ["2026-01", "2026-02", "2026-03"]:
            response = requests.get(f"{BASE_URL}/api/month-details/{month}", params={
                "entity_id": test_entity["id"],
                "scenario": "committed"
            })
            assert response.status_code == 200
            data = response.json()
            
            # Find our flow in all_flows
            flow_in_month = next((f for f in data["all_flows"] if f.get("label") == "TEST_DistRounding"), None)
            if flow_in_month:
                total_distributed += flow_in_month["amount"]
        
        # Total distributed should equal original amount (10000)
        assert abs(total_distributed - 10000) <= 1, f"Total should be ~10000, got {total_distributed}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_linked_flows_inherit_distribute_mode(self, test_entity):
        """Distribute mode + linked flows: child inherits distribute mode and count"""
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_DistParent",
                "amount": 24000,
                "date": "2026-01-01",
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "distribute",
                "recurrence_count": 4,
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_DistChild",
                    "amount": 0,
                    "date": "2026-01-01",
                    "category": "COGS",
                    "certainty": "Sure to happen",
                    "entity_id": test_entity["id"],
                    "is_percentage": True,
                    "percentage_of_parent": 40
                }
            ]
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify child inherited distribute mode
        child = data["linked"][0]
        assert child["recurrence"] == "monthly"
        assert child["recurrence_mode"] == "distribute"
        assert child["recurrence_count"] == 4
        
    def test_update_propagates_recurrence_mode_to_children(self, test_entity):
        """PUT /api/cash-flows/{id} propagates recurrence_mode changes to children"""
        # Create parent with repeat mode
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_ModeChangeParent",
                "amount": 12000,
                "date": "2026-01-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "monthly",
                "recurrence_mode": "repeat",
                "recurrence_count": 6,
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_ModeChangeChild",
                    "amount": -2000,
                    "date": "2026-01-01",
                    "category": "COGS",
                    "certainty": "Materialized",
                    "entity_id": test_entity["id"],
                    "is_percentage": False
                }
            ]
        })
        assert response.status_code == 200
        parent_id = response.json()["parent"]["id"]
        child_id = response.json()["linked"][0]["id"]
        
        # Update parent to distribute mode
        response = requests.put(f"{BASE_URL}/api/cash-flows/{parent_id}", json={
            "recurrence_mode": "distribute"
        })
        assert response.status_code == 200
        
        # Verify child was updated
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked", params={"entity_id": test_entity["id"]})
        flows = response.json()
        parent_flow = next((f for f in flows if f["flow"]["id"] == parent_id), None)
        assert parent_flow is not None
        
        if parent_flow["linked_flows"]:
            child = parent_flow["linked_flows"][0]
            assert child["recurrence_mode"] == "distribute", f"Expected 'distribute', got {child['recurrence_mode']}"


class TestFlowStatusAndCarryover:
    """Tests for flow occurrence status (planned/paid/unpaid) and carryover"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for status tests"""
        entity_name = f"TEST_StatusEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_set_flow_occurrence_status(self, test_entity):
        """PUT /api/flow-occurrences sets status for a flow occurrence"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_StatusFlow",
            "amount": -5000,
            "date": "2026-02-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Set status to paid
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-02",
            "status": "paid"
        })
        assert response.status_code == 200
        
        # Verify status was set
        response = requests.get(f"{BASE_URL}/api/flow-occurrences", params={"flow_id": flow_id})
        assert response.status_code == 200
        occurrences = response.json()
        assert len(occurrences) > 0
        assert occurrences[0]["status"] == "paid"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_unpaid_creates_carryover(self, test_entity):
        """PUT /api/flow-occurrences marks flow as unpaid and creates carryover in next month"""
        # Create a flow for January
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_CarryoverFlow",
            "amount": -3000,
            "date": "2026-01-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Mark as unpaid
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-01",
            "status": "unpaid"
        })
        assert response.status_code == 200
        
        # Check for carryover flow in February
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is not None, "Carryover flow should be created"
        assert carryover["carryover_month"] == "2026-01"
        assert "(carryover)" in carryover["label"]
        assert carryover["date"].startswith("2026-02")  # Next month
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        if carryover:
            requests.delete(f"{BASE_URL}/api/cash-flows/{carryover['id']}")
            
    def test_paid_or_planned_removes_carryover(self, test_entity):
        """PUT /api/flow-occurrences marks flow as paid, then planned removes carryover"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_RemoveCarryover",
            "amount": -2000,
            "date": "2026-03-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Mark as unpaid (creates carryover)
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-03",
            "status": "unpaid"
        })
        assert response.status_code == 200
        
        # Verify carryover exists
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is not None
        
        # Mark as paid (should remove carryover)
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-03",
            "status": "paid"
        })
        assert response.status_code == 200
        
        # Verify carryover was removed
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is None, "Carryover should be removed when status changes to paid"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_get_flow_occurrences_by_month(self, test_entity):
        """GET /api/flow-occurrences returns occurrences filtered by month"""
        # Create flows
        flow1_resp = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_OccFlow1",
            "amount": -1000,
            "date": "2026-04-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        flow1_id = flow1_resp.json()["id"]
        
        flow2_resp = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_OccFlow2",
            "amount": -2000,
            "date": "2026-05-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        flow2_id = flow2_resp.json()["id"]
        
        # Set statuses
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow1_id, "month": "2026-04", "status": "paid"
        })
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow2_id, "month": "2026-05", "status": "planned"
        })
        
        # Get occurrences for April only
        response = requests.get(f"{BASE_URL}/api/flow-occurrences", params={"month": "2026-04"})
        assert response.status_code == 200
        occurrences = response.json()
        
        # Should only have April occurrence
        april_occs = [o for o in occurrences if o["month"] == "2026-04"]
        assert len(april_occs) >= 1
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow1_id}")
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow2_id}")
        
    def test_projection_skips_unpaid_occurrences(self, test_entity):
        """Projection engine skips unpaid occurrences (they don't count in original month)"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SkipUnpaid",
            "amount": -5000,
            "date": "2026-06-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Get projection before marking unpaid
        response = requests.get(f"{BASE_URL}/api/projection", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        data_before = response.json()
        june_before = next((m for m in data_before["months"] if m["month"] == "2026-06"), None)
        outflows_before = june_before["outflows"] if june_before else 0
        
        # Mark as unpaid
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-06",
            "status": "unpaid"
        })
        
        # Get projection after marking unpaid
        response = requests.get(f"{BASE_URL}/api/projection", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        data_after = response.json()
        june_after = next((m for m in data_after["months"] if m["month"] == "2026-06"), None)
        outflows_after = june_after["outflows"] if june_after else 0
        
        # June outflows should be reduced by 5000 (the unpaid flow)
        assert outflows_after < outflows_before, "Unpaid flow should be skipped in projection"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        # Also delete carryover
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]}).json()
        for f in flows:
            if f.get("carryover_from") == flow_id:
                requests.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")
                
    def test_carryover_appears_in_next_month_projection(self, test_entity):
        """Carryover flows appear in projection for the next month"""
        # Create a flow for July
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_CarryoverProjection",
            "amount": -4000,
            "date": "2026-07-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Mark as unpaid (creates carryover in August)
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-07",
            "status": "unpaid"
        })
        
        # Get projection
        response = requests.get(f"{BASE_URL}/api/projection", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        data = response.json()
        
        # August should have the carryover outflow
        august = next((m for m in data["months"] if m["month"] == "2026-08"), None)
        assert august is not None
        assert august["outflows"] >= 4000, f"August should have carryover outflow, got {august['outflows']}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]}).json()
        for f in flows:
            if f.get("carryover_from") == flow_id:
                requests.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")


class TestMonthDetailsWithStatus:
    """Tests for month details endpoint with flow status and carryover info"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_MonthDetailsEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_month_details_returns_flow_status(self, test_entity):
        """GET /api/month-details/{month} returns flow_id, status, is_carryover for each flow"""
        # Create a flow
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_MonthDetailFlow",
            "amount": -3000,
            "date": "2026-08-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Set status
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-08",
            "status": "paid"
        })
        
        # Get month details
        response = requests.get(f"{BASE_URL}/api/month-details/2026-08", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify all_flows contains status info
        assert "all_flows" in data
        flow_in_details = next((f for f in data["all_flows"] if f.get("flow_id") == flow_id), None)
        assert flow_in_details is not None, "Flow should appear in month details"
        assert "status" in flow_in_details
        assert flow_in_details["status"] == "paid"
        assert "is_carryover" in flow_in_details
        assert flow_in_details["is_carryover"] == False
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        
    def test_month_details_shows_carryover_flag(self, test_entity):
        """Month details shows is_carryover=True for carryover flows"""
        # Create a flow for September
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_CarryoverDetail",
            "amount": -2500,
            "date": "2026-09-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Mark as unpaid (creates carryover in October)
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-09",
            "status": "unpaid"
        })
        
        # Get October month details (should have carryover)
        response = requests.get(f"{BASE_URL}/api/month-details/2026-10", params={
            "entity_id": test_entity["id"],
            "scenario": "committed"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Find carryover flow
        carryover_flow = next((f for f in data["all_flows"] if f.get("is_carryover") == True), None)
        assert carryover_flow is not None, "Carryover flow should appear in October details"
        assert "(carryover)" in carryover_flow["label"]
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]}).json()
        for f in flows:
            if f.get("carryover_from") == flow_id:
                requests.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")


class TestDistributeWithCarryover:
    """Tests for distribute mode combined with carryover"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity"""
        entity_name = f"TEST_DistCarryEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
    
    def test_distribute_carryover_uses_per_period_amount(self, test_entity):
        """Carryover for distribute mode uses per-period amount, not total"""
        # Create a distribute flow: 12000 over 4 months = 3000/month
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_DistCarryover",
            "amount": -12000,
            "date": "2026-10-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "monthly",
            "recurrence_mode": "distribute",
            "recurrence_count": 4,
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow_id = response.json()["id"]
        
        # Mark October occurrence as unpaid
        requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow_id,
            "month": "2026-10",
            "status": "unpaid"
        })
        
        # Check carryover amount - should be 3000 (per-period), not 12000 (total)
        response = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": test_entity["id"]})
        flows = response.json()
        
        carryover = next((f for f in flows if f.get("carryover_from") == flow_id), None)
        assert carryover is not None
        # Carryover should be -3000 (per-period amount)
        assert carryover["amount"] == -3000, f"Expected -3000, got {carryover['amount']}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow_id}")
        if carryover:
            requests.delete(f"{BASE_URL}/api/cash-flows/{carryover['id']}")


class TestAPIHealth:
    """Basic API health checks for new endpoints"""
    
    def test_flow_occurrences_endpoint_exists(self):
        """GET /api/flow-occurrences endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/flow-occurrences")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_put_flow_occurrences_endpoint_exists(self):
        """PUT /api/flow-occurrences endpoint exists"""
        # This will fail validation but should return 422, not 404
        response = requests.put(f"{BASE_URL}/api/flow-occurrences", json={})
        assert response.status_code in [200, 422], f"Expected 200 or 422, got {response.status_code}"
