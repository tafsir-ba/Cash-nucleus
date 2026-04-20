"""
Cash Piloting Dashboard - Backend API Tests
Tests for: Projection engine (horizon 12/24/36), linked flows, CRUD operations, month details
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://cash-risk-map.preview.emergentagent.com').rstrip('/')

# At least MIN_SURFACE_HISTORY_MONTHS (2) before current + horizon forward when no older data
MIN_SURFACE_PLUS_HORIZON = lambda h: h + 2


class TestProjectionEngine:
    """Tests for projection endpoint with different horizons"""
    
    def test_projection_horizon_12_months(self):
        """GET /api/projection with horizon=12 returns at least forward + surface history"""
        response = requests.get(f"{BASE_URL}/api/projection", params={"horizon": 12})
        assert response.status_code == 200
        data = response.json()
        assert len(data["months"]) >= MIN_SURFACE_PLUS_HORIZON(12), f"Expected at least {MIN_SURFACE_PLUS_HORIZON(12)} months, got {len(data['months'])}"
        
    def test_projection_horizon_24_months(self):
        """GET /api/projection with horizon=24 returns at least forward + surface history"""
        response = requests.get(f"{BASE_URL}/api/projection", params={"horizon": 24})
        assert response.status_code == 200
        data = response.json()
        assert len(data["months"]) >= MIN_SURFACE_PLUS_HORIZON(24), f"Expected at least {MIN_SURFACE_PLUS_HORIZON(24)} months, got {len(data['months'])}"
        
    def test_projection_horizon_36_months(self):
        """GET /api/projection with horizon=36 returns at least forward + surface history"""
        response = requests.get(f"{BASE_URL}/api/projection", params={"horizon": 36})
        assert response.status_code == 200
        data = response.json()
        assert len(data["months"]) >= MIN_SURFACE_PLUS_HORIZON(36), f"Expected at least {MIN_SURFACE_PLUS_HORIZON(36)} months, got {len(data['months'])}"
        
    def test_projection_response_structure(self):
        """GET /api/projection returns correct structure with all KPI fields"""
        response = requests.get(f"{BASE_URL}/api/projection")
        assert response.status_code == 200
        data = response.json()
        
        # Verify all required fields exist
        required_fields = ["cash_now", "lowest_cash", "lowest_cash_month", 
                          "first_watch_month", "first_danger_month", "overall_status", 
                          "safety_buffer", "months"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        
        # Verify cash_now is a number
        assert isinstance(data["cash_now"], (int, float))
        
        # Verify overall_status is valid
        assert data["overall_status"] in ["Good", "Watch", "Danger"]
        
    def test_projection_month_structure(self):
        """Each month in projection has correct structure"""
        response = requests.get(f"{BASE_URL}/api/projection", params={"horizon": 12})
        assert response.status_code == 200
        data = response.json()
        
        for month in data["months"]:
            assert "month" in month
            assert "month_label" in month
            assert "inflows" in month
            assert "outflows" in month
            assert "net" in month
            assert "closing_cash" in month
            assert "status" in month
            assert month["status"] in ["Good", "Watch", "Danger"]
            
    def test_projection_with_scenario_filter(self):
        """GET /api/projection with different scenarios"""
        scenarios = ["committed", "likely", "extended", "full"]
        for scenario in scenarios:
            response = requests.get(f"{BASE_URL}/api/projection", params={"scenario": scenario})
            assert response.status_code == 200, f"Failed for scenario: {scenario}"
            data = response.json()
            assert "months" in data


class TestEntityCRUD:
    """Tests for entity CRUD operations"""
    
    def test_get_entities(self):
        """GET /api/entities returns list"""
        response = requests.get(f"{BASE_URL}/api/entities")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
    def test_create_and_delete_entity(self):
        """POST /api/entities creates entity, DELETE removes it"""
        # Create
        entity_name = f"TEST_Entity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={
            "name": entity_name,
            "description": "Test entity for automated testing"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == entity_name
        entity_id = data["id"]
        
        # Verify it exists
        response = requests.get(f"{BASE_URL}/api/entities")
        assert response.status_code == 200
        entities = response.json()
        assert any(e["id"] == entity_id for e in entities)
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/entities/{entity_id}")
        assert response.status_code == 200
        
        # Verify deleted
        response = requests.get(f"{BASE_URL}/api/entities")
        entities = response.json()
        assert not any(e["id"] == entity_id for e in entities)


class TestBankAccountCRUD:
    """Tests for bank account CRUD operations"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for bank account tests"""
        entity_name = f"TEST_BankEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
        
    def test_get_bank_accounts(self):
        """GET /api/bank-accounts returns list"""
        response = requests.get(f"{BASE_URL}/api/bank-accounts")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_create_update_delete_bank_account(self, test_entity):
        """Full CRUD cycle for bank account"""
        # Create
        response = requests.post(f"{BASE_URL}/api/bank-accounts", json={
            "entity_id": test_entity["id"],
            "label": "TEST_Account",
            "amount": 10000.50
        })
        assert response.status_code == 200
        account = response.json()
        assert account["label"] == "TEST_Account"
        assert account["amount"] == 10000.50
        account_id = account["id"]
        
        # Update
        response = requests.put(f"{BASE_URL}/api/bank-accounts/{account_id}", json={
            "amount": 15000.00
        })
        assert response.status_code == 200
        updated = response.json()
        assert updated["amount"] == 15000.00
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/bank-accounts/{account_id}")
        assert response.status_code == 200


class TestCashFlowCRUD:
    """Tests for cash flow CRUD operations"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for cash flow tests"""
        entity_name = f"TEST_FlowEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup - delete flows first, then entity
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
        
    def test_get_cash_flows(self):
        """GET /api/cash-flows returns list"""
        response = requests.get(f"{BASE_URL}/api/cash-flows")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_create_simple_cash_flow(self, test_entity):
        """POST /api/cash-flows creates a simple flow"""
        response = requests.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SimpleFlow",
            "amount": -5000,
            "date": "2026-06-01",
            "category": "Expense",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": test_entity["id"]
        })
        assert response.status_code == 200
        flow = response.json()
        assert flow["label"] == "TEST_SimpleFlow"
        assert flow["amount"] == -5000
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        
    def test_get_cash_flows_with_linked(self):
        """GET /api/cash-flows/with-linked returns grouped flows"""
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Each item should have flow and linked_flows
        if len(data) > 0:
            assert "flow" in data[0]
            assert "linked_flows" in data[0]


class TestLinkedFlows:
    """Tests for parent-child linked flows with percentage calculation"""
    
    @pytest.fixture
    def test_entity(self):
        """Create a test entity for linked flow tests"""
        entity_name = f"TEST_LinkedEntity_{uuid.uuid4().hex[:8]}"
        response = requests.post(f"{BASE_URL}/api/entities", json={"name": entity_name})
        entity = response.json()
        yield entity
        # Cleanup
        flows = requests.get(f"{BASE_URL}/api/cash-flows", params={"entity_id": entity["id"]}).json()
        for flow in flows:
            requests.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/entities/{entity['id']}")
        
    def test_batch_create_parent_with_linked_child(self, test_entity):
        """POST /api/cash-flows/batch creates parent + linked child with percentage"""
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_ParentRevenue",
                "amount": 10000,
                "date": "2026-07-01",
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_count": 6,
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_COGS (40%)",
                    "amount": 0,  # Will be calculated
                    "date": "2026-07-01",
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
        
        # Verify parent
        assert data["parent"]["label"] == "TEST_ParentRevenue"
        assert data["parent"]["amount"] == 10000
        parent_id = data["parent"]["id"]
        
        # Verify linked child
        assert len(data["linked"]) == 1
        linked = data["linked"][0]
        assert linked["parent_id"] == parent_id
        assert linked["is_percentage"] == True
        assert linked["percentage_of_parent"] == 40
        # Child amount should be calculated: -(10000 * 40 / 100) = -4000
        assert linked["amount"] == -4000
        
        # Verify recurrence inherited
        assert linked["recurrence"] == "monthly"
        assert linked["recurrence_count"] == 6
        
    def test_parent_update_propagates_to_children(self, test_entity):
        """PUT /api/cash-flows/{id} propagates changes to children"""
        # Create parent with linked child
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_PropagateParent",
                "amount": 20000,
                "date": "2026-08-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "monthly",
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_PropagateChild",
                    "amount": 0,
                    "date": "2026-08-01",
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
        
        # Update parent amount - should recalculate child
        response = requests.put(f"{BASE_URL}/api/cash-flows/{parent_id}", json={
            "amount": 30000
        })
        assert response.status_code == 200
        
        # Verify child amount was recalculated
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked", params={"entity_id": test_entity["id"]})
        flows = response.json()
        parent_flow = next((f for f in flows if f["flow"]["id"] == parent_id), None)
        assert parent_flow is not None
        
        # Child should now be -(30000 * 30 / 100) = -9000
        if parent_flow["linked_flows"]:
            child = parent_flow["linked_flows"][0]
            assert child["amount"] == -9000, f"Expected -9000, got {child['amount']}"
            
    def test_parent_update_propagates_certainty(self, test_entity):
        """PUT /api/cash-flows/{id} propagates certainty changes to children"""
        # Create parent with linked child
        response = requests.post(f"{BASE_URL}/api/cash-flows/batch", json={
            "parent": {
                "label": "TEST_CertaintyParent",
                "amount": 5000,
                "date": "2026-09-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "none",
                "entity_id": test_entity["id"]
            },
            "linked": [
                {
                    "label": "TEST_CertaintyChild",
                    "amount": -1000,
                    "date": "2026-09-01",
                    "category": "COGS",
                    "certainty": "Materialized",
                    "entity_id": test_entity["id"],
                    "is_percentage": False
                }
            ]
        })
        assert response.status_code == 200
        parent_id = response.json()["parent"]["id"]
        
        # Update parent certainty
        response = requests.put(f"{BASE_URL}/api/cash-flows/{parent_id}", json={
            "certainty": "50/50"
        })
        assert response.status_code == 200
        
        # Verify child certainty was updated
        response = requests.get(f"{BASE_URL}/api/cash-flows/with-linked", params={"entity_id": test_entity["id"]})
        flows = response.json()
        parent_flow = next((f for f in flows if f["flow"]["id"] == parent_id), None)
        if parent_flow and parent_flow["linked_flows"]:
            child = parent_flow["linked_flows"][0]
            assert child["certainty"] == "50/50"


class TestMonthDetails:
    """Tests for month details endpoint"""
    
    def test_get_month_details(self):
        """GET /api/month-details/{month} returns breakdown"""
        response = requests.get(f"{BASE_URL}/api/month-details/2026-06")
        assert response.status_code == 200
        data = response.json()
        
        assert "month" in data
        assert "top_outflows" in data
        assert "recurring_burdens" in data
        assert "all_flows" in data
        assert data["month"] == "2026-06"
        
    def test_month_details_with_scenario(self):
        """GET /api/month-details with scenario filter"""
        response = requests.get(f"{BASE_URL}/api/month-details/2026-06", params={"scenario": "full"})
        assert response.status_code == 200
        data = response.json()
        assert "all_flows" in data


class TestSettings:
    """Tests for settings endpoint"""
    
    def test_get_settings(self):
        """GET /api/settings returns settings"""
        response = requests.get(f"{BASE_URL}/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert "safety_buffer" in data
        assert isinstance(data["safety_buffer"], (int, float))
        
    def test_update_settings(self):
        """PUT /api/settings updates safety buffer"""
        # Get current
        response = requests.get(f"{BASE_URL}/api/settings")
        original_buffer = response.json()["safety_buffer"]
        
        # Update
        new_buffer = 75000.0
        response = requests.put(f"{BASE_URL}/api/settings", json={
            "safety_buffer": new_buffer
        })
        assert response.status_code == 200
        assert response.json()["safety_buffer"] == new_buffer
        
        # Restore original
        requests.put(f"{BASE_URL}/api/settings", json={"safety_buffer": original_buffer})


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_root(self):
        """GET /api/ returns welcome message"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        assert "message" in response.json()
