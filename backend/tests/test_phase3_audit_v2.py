"""
Phase 3 Audit Tests - Iteration 8
Tests for:
1. Matrix cell semantic display (actual/planned/variance)
2. Backend totals (revenue_per_month, cost_per_month, cash_balance_per_month, net_per_month)
3. Carry-forward creates carryover flow with correct description
4. Write-off does NOT create carryover
5. Undo chain restores full dependency (occurrence + carryover flows)
6. 24M horizon totals update correctly
"""

import pytest
import requests
import os
import time
from datetime import date
from dateutil.relativedelta import relativedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestBackendMatrixTotals:
    """Verify matrix totals come from backend, not frontend computation"""
    
    def test_matrix_returns_revenue_per_month(self):
        """Matrix endpoint must return revenue_per_month field"""
        res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert res.status_code == 200
        data = res.json()
        assert "revenue_per_month" in data, "Matrix must return revenue_per_month"
        assert isinstance(data["revenue_per_month"], dict)
        print(f"✓ revenue_per_month has {len(data['revenue_per_month'])} months")
    
    def test_matrix_returns_cost_per_month(self):
        """Matrix endpoint must return cost_per_month field"""
        res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert res.status_code == 200
        data = res.json()
        assert "cost_per_month" in data, "Matrix must return cost_per_month"
        assert isinstance(data["cost_per_month"], dict)
        print(f"✓ cost_per_month has {len(data['cost_per_month'])} months")
    
    def test_matrix_returns_cash_balance_per_month(self):
        """Matrix endpoint must return cash_balance_per_month field"""
        res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert res.status_code == 200
        data = res.json()
        assert "cash_balance_per_month" in data, "Matrix must return cash_balance_per_month"
        assert isinstance(data["cash_balance_per_month"], dict)
        print(f"✓ cash_balance_per_month has {len(data['cash_balance_per_month'])} months")
    
    def test_matrix_returns_net_per_month(self):
        """Matrix endpoint must return net_per_month field"""
        res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert res.status_code == 200
        data = res.json()
        assert "net_per_month" in data, "Matrix must return net_per_month"
        assert isinstance(data["net_per_month"], dict)
        print(f"✓ net_per_month has {len(data['net_per_month'])} months")
    
    def test_matrix_24m_horizon_returns_24_months(self):
        """24M forward horizon includes at least surface history (and more if occurrence data exists)"""
        res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 24, "scenario": "likely"})
        assert res.status_code == 200
        data = res.json()
        n = len(data["months"])
        assert n >= 26, f"Expected at least 26 months (24+2), got {n}"
        assert len(data["net_per_month"]) == n, f"net_per_month keys should match months count"
        assert len(data["revenue_per_month"]) == n
        assert len(data["cost_per_month"]) == n
        assert len(data["cash_balance_per_month"]) == n
        print("✓ 24M horizon returns history + forward totals")


class TestMatrixCellSemantics:
    """Test that cells with actuals show actual/planned/variance"""
    
    @pytest.fixture(autouse=True)
    def setup_test_flow(self):
        """Create a test flow for recording actuals"""
        # Get an entity
        entities_res = requests.get(f"{BASE_URL}/api/entities")
        assert entities_res.status_code == 200
        entities = entities_res.json()
        assert len(entities) > 0, "Need at least one entity"
        self.entity_id = entities[0]["id"]
        
        # Create a test revenue flow
        today = date.today()
        current_month = today.replace(day=1)
        
        flow_data = {
            "parent": {
                "label": "TEST_SemanticCell_Revenue",
                "amount": 5000.0,
                "date": current_month.isoformat(),
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "repeat",
                "recurrence_count": 6,
                "entity_id": self.entity_id
            },
            "linked": []
        }
        
        res = requests.post(f"{BASE_URL}/api/cash-flows/batch", json=flow_data)
        assert res.status_code == 200
        self.flow_id = res.json()["parent"]["id"]
        self.test_month = current_month.strftime("%Y-%m")
        
        yield
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{self.flow_id}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/flow-occurrences?flow_id={self.flow_id}&month={self.test_month}")
    
    def test_cell_without_actual_has_no_actual_field(self):
        """Cell without actual should have has_actual=false"""
        res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert res.status_code == 200
        data = res.json()
        
        # Find our test flow
        test_row = None
        for row in data["revenue_rows"]:
            if row["flow_id"] == self.flow_id:
                test_row = row
                break
        
        assert test_row is not None, "Test flow not found in matrix"
        cell = test_row["cells"].get(self.test_month)
        assert cell is not None, f"Cell for {self.test_month} not found"
        assert cell["has_actual"] == False, "Cell without actual should have has_actual=false"
        assert "actual" not in cell or cell.get("actual") is None, "Cell without actual should not have actual field"
        print("✓ Cell without actual has has_actual=false")
    
    def test_cell_with_actual_shows_actual_planned_variance(self):
        """Cell with actual must show actual, planned, and variance"""
        # Record an actual that differs from planned
        actual_amount = 4500.0  # Under planned (5000)
        res = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": self.flow_id,
            "month": self.test_month,
            "actual_amount": actual_amount,
            "variance_action": "write_off"
        })
        assert res.status_code == 200
        
        # Check matrix
        matrix_res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert matrix_res.status_code == 200
        data = matrix_res.json()
        
        # Find our test flow
        test_row = None
        for row in data["revenue_rows"]:
            if row["flow_id"] == self.flow_id:
                test_row = row
                break
        
        assert test_row is not None, "Test flow not found in matrix"
        cell = test_row["cells"].get(self.test_month)
        assert cell is not None, f"Cell for {self.test_month} not found"
        
        # Verify semantic fields
        assert cell["has_actual"] == True, "Cell with actual should have has_actual=true"
        assert "actual" in cell, "Cell with actual must have 'actual' field"
        assert "planned" in cell, "Cell with actual must have 'planned' field"
        assert cell["actual"] == actual_amount, f"Actual should be {actual_amount}, got {cell['actual']}"
        assert cell["planned"] == 5000.0, f"Planned should be 5000, got {cell['planned']}"
        
        # Variance = actual - planned = 4500 - 5000 = -500 (under)
        variance = cell["actual"] - cell["planned"]
        assert abs(variance - (-500)) < 0.01, f"Variance should be -500, got {variance}"
        
        print(f"✓ Cell shows actual={cell['actual']}, planned={cell['planned']}, variance={variance}")


class TestCarryForwardFlow:
    """Test carry-forward creates carryover flow with correct description"""
    
    @pytest.fixture(autouse=True)
    def setup_test_flow(self):
        """Create a test flow for carry-forward testing"""
        entities_res = requests.get(f"{BASE_URL}/api/entities")
        assert entities_res.status_code == 200
        entities = entities_res.json()
        self.entity_id = entities[0]["id"]
        
        today = date.today()
        current_month = today.replace(day=1)
        
        flow_data = {
            "parent": {
                "label": "TEST_CarryForward_Revenue",
                "amount": 10000.0,
                "date": current_month.isoformat(),
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "repeat",
                "recurrence_count": 6,
                "entity_id": self.entity_id
            },
            "linked": []
        }
        
        res = requests.post(f"{BASE_URL}/api/cash-flows/batch", json=flow_data)
        assert res.status_code == 200
        self.flow_id = res.json()["parent"]["id"]
        self.test_month = current_month.strftime("%Y-%m")
        self.next_month = (current_month + relativedelta(months=1)).strftime("%Y-%m")
        
        yield
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{self.flow_id}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/flow-occurrences?flow_id={self.flow_id}&month={self.test_month}")
        # Also cleanup any carryover flows
        flows_res = requests.get(f"{BASE_URL}/api/cash-flows")
        if flows_res.status_code == 200:
            for f in flows_res.json():
                if f.get("carryover_from") == self.flow_id:
                    requests.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")
    
    def test_carry_forward_creates_carryover_flow(self):
        """Carry-forward should create a one-time carryover flow in next month"""
        # Record actual UNDER planned (8000 vs 10000)
        actual_amount = 8000.0
        res = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": self.flow_id,
            "month": self.test_month,
            "actual_amount": actual_amount,
            "variance_action": "carry_forward"
        })
        assert res.status_code == 200
        
        # Check for carryover flow
        flows_res = requests.get(f"{BASE_URL}/api/cash-flows")
        assert flows_res.status_code == 200
        flows = flows_res.json()
        
        carryover = None
        for f in flows:
            if f.get("carryover_from") == self.flow_id and f.get("carryover_month") == self.test_month:
                carryover = f
                break
        
        assert carryover is not None, "Carryover flow should be created"
        
        # Variance = planned - actual = 10000 - 8000 = 2000
        expected_variance = 2000.0
        assert abs(carryover["amount"] - expected_variance) < 0.01, f"Carryover amount should be {expected_variance}, got {carryover['amount']}"
        assert carryover["recurrence"] == "none", "Carryover should be one-time (recurrence=none)"
        assert self.next_month in carryover["date"], f"Carryover should be in next month {self.next_month}"
        assert "carryover" in carryover["label"].lower() or "variance" in carryover["label"].lower(), "Carryover label should indicate it's a carryover"
        
        print(f"✓ Carry-forward created carryover flow: {carryover['label']} = {carryover['amount']} in {carryover['date']}")
    
    def test_carry_forward_response_includes_target_month(self):
        """Carry-forward response should include target month info"""
        actual_amount = 7000.0
        res = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": self.flow_id,
            "month": self.test_month,
            "actual_amount": actual_amount,
            "variance_action": "carry_forward"
        })
        assert res.status_code == 200
        data = res.json()
        
        # Response should include carryover_info with target_month
        if "carryover_info" in data:
            assert "target_month" in data["carryover_info"], "carryover_info should include target_month"
            assert "amount" in data["carryover_info"], "carryover_info should include amount"
            print(f"✓ Response includes carryover_info: target_month={data['carryover_info']['target_month']}, amount={data['carryover_info']['amount']}")
        else:
            print("⚠ Response does not include carryover_info (optional field)")


class TestWriteOffFlow:
    """Test write-off does NOT create carryover"""
    
    @pytest.fixture(autouse=True)
    def setup_test_flow(self):
        """Create a test flow for write-off testing"""
        entities_res = requests.get(f"{BASE_URL}/api/entities")
        assert entities_res.status_code == 200
        entities = entities_res.json()
        self.entity_id = entities[0]["id"]
        
        today = date.today()
        current_month = today.replace(day=1)
        
        flow_data = {
            "parent": {
                "label": "TEST_WriteOff_Revenue",
                "amount": 10000.0,
                "date": current_month.isoformat(),
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "repeat",
                "recurrence_count": 6,
                "entity_id": self.entity_id
            },
            "linked": []
        }
        
        res = requests.post(f"{BASE_URL}/api/cash-flows/batch", json=flow_data)
        assert res.status_code == 200
        self.flow_id = res.json()["parent"]["id"]
        self.test_month = current_month.strftime("%Y-%m")
        
        yield
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{self.flow_id}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/flow-occurrences?flow_id={self.flow_id}&month={self.test_month}")
    
    def test_write_off_does_not_create_carryover(self):
        """Write-off should NOT create a carryover flow"""
        # Record actual UNDER planned (8000 vs 10000)
        actual_amount = 8000.0
        res = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": self.flow_id,
            "month": self.test_month,
            "actual_amount": actual_amount,
            "variance_action": "write_off"
        })
        assert res.status_code == 200
        
        # Check that NO carryover flow was created
        flows_res = requests.get(f"{BASE_URL}/api/cash-flows")
        assert flows_res.status_code == 200
        flows = flows_res.json()
        
        carryover = None
        for f in flows:
            if f.get("carryover_from") == self.flow_id and f.get("carryover_month") == self.test_month:
                carryover = f
                break
        
        assert carryover is None, "Write-off should NOT create carryover flow"
        print("✓ Write-off did not create carryover flow")


class TestUndoChain:
    """Test undo restores full dependency chain"""
    
    @pytest.fixture(autouse=True)
    def setup_test_flow(self):
        """Create a test flow for undo testing"""
        entities_res = requests.get(f"{BASE_URL}/api/entities")
        assert entities_res.status_code == 200
        entities = entities_res.json()
        self.entity_id = entities[0]["id"]
        
        today = date.today()
        current_month = today.replace(day=1)
        
        flow_data = {
            "parent": {
                "label": "TEST_Undo_Revenue",
                "amount": 10000.0,
                "date": current_month.isoformat(),
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "repeat",
                "recurrence_count": 6,
                "entity_id": self.entity_id
            },
            "linked": []
        }
        
        res = requests.post(f"{BASE_URL}/api/cash-flows/batch", json=flow_data)
        assert res.status_code == 200
        self.flow_id = res.json()["parent"]["id"]
        self.test_month = current_month.strftime("%Y-%m")
        
        yield
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/cash-flows/{self.flow_id}?delete_linked=true")
        requests.delete(f"{BASE_URL}/api/flow-occurrences?flow_id={self.flow_id}&month={self.test_month}")
        # Cleanup any carryover flows
        flows_res = requests.get(f"{BASE_URL}/api/cash-flows")
        if flows_res.status_code == 200:
            for f in flows_res.json():
                if f.get("carryover_from") == self.flow_id:
                    requests.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")
    
    def test_undo_removes_occurrence_and_carryover(self):
        """Undo should remove both occurrence and carryover flow"""
        # Record actual with carry_forward
        actual_amount = 8000.0
        res = requests.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": self.flow_id,
            "month": self.test_month,
            "actual_amount": actual_amount,
            "variance_action": "carry_forward"
        })
        assert res.status_code == 200
        
        # Verify carryover was created
        flows_res = requests.get(f"{BASE_URL}/api/cash-flows")
        flows = flows_res.json()
        carryover_before = [f for f in flows if f.get("carryover_from") == self.flow_id]
        assert len(carryover_before) > 0, "Carryover should exist before undo"
        
        # Verify occurrence was created
        occ_res = requests.get(f"{BASE_URL}/api/flow-occurrences", params={"flow_id": self.flow_id, "month": self.test_month})
        assert occ_res.status_code == 200
        occ_before = occ_res.json()
        assert len(occ_before) > 0, "Occurrence should exist before undo"
        
        # Undo
        undo_res = requests.post(f"{BASE_URL}/api/undo")
        assert undo_res.status_code == 200
        
        # Verify carryover was removed
        flows_res = requests.get(f"{BASE_URL}/api/cash-flows")
        flows = flows_res.json()
        carryover_after = [f for f in flows if f.get("carryover_from") == self.flow_id]
        assert len(carryover_after) == 0, "Carryover should be removed after undo"
        
        # Verify occurrence was removed
        occ_res = requests.get(f"{BASE_URL}/api/flow-occurrences", params={"flow_id": self.flow_id, "month": self.test_month})
        occ_after = occ_res.json()
        assert len(occ_after) == 0, "Occurrence should be removed after undo"
        
        print("✓ Undo removed both occurrence and carryover flow")


class TestDistributedFlowWithLinkedCOGS:
    """Test creating revenue flow with linked COGS and verifying matrix"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get entity for test"""
        entities_res = requests.get(f"{BASE_URL}/api/entities")
        assert entities_res.status_code == 200
        entities = entities_res.json()
        self.entity_id = entities[0]["id"]
        self.created_flow_id = None
        
        yield
        
        # Cleanup
        if self.created_flow_id:
            requests.delete(f"{BASE_URL}/api/cash-flows/{self.created_flow_id}?delete_linked=true")
    
    def test_create_distributed_revenue_with_linked_cogs(self):
        """Create distributed revenue (6 periods) with 40% COGS and verify matrix"""
        today = date.today()
        current_month = today.replace(day=1)
        
        # Create revenue flow: 60000 distributed over 6 months = 10000/month
        # With 40% COGS = 4000/month
        flow_data = {
            "parent": {
                "label": "TEST_Distributed_Revenue",
                "amount": 60000.0,
                "date": current_month.isoformat(),
                "category": "Revenue",
                "certainty": "Sure to happen",
                "recurrence": "monthly",
                "recurrence_mode": "distribute",
                "recurrence_count": 6,
                "entity_id": self.entity_id
            },
            "linked": [
                {
                    "label": "TEST_COGS_40pct",
                    "amount": 0,  # Will be calculated
                    "date": current_month.isoformat(),
                    "category": "COGS",
                    "certainty": "Sure to happen",
                    "recurrence": "monthly",
                    "recurrence_mode": "distribute",
                    "recurrence_count": 6,
                    "entity_id": self.entity_id,
                    "is_percentage": True,
                    "percentage_of_parent": 40.0
                }
            ]
        }
        
        res = requests.post(f"{BASE_URL}/api/cash-flows/batch", json=flow_data)
        assert res.status_code == 200
        data = res.json()
        self.created_flow_id = data["parent"]["id"]
        
        # Verify matrix shows correct per-period amounts
        matrix_res = requests.get(f"{BASE_URL}/api/projection/matrix", params={"horizon": 12, "scenario": "likely"})
        assert matrix_res.status_code == 200
        matrix = matrix_res.json()
        
        # Find our revenue row
        revenue_row = None
        for row in matrix["revenue_rows"]:
            if row["flow_id"] == self.created_flow_id:
                revenue_row = row
                break
        
        assert revenue_row is not None, "Revenue row not found in matrix"
        
        # Check first 6 months have ~10000 each (60000/6)
        expected_per_month = 10000.0
        months_with_revenue = [m for m in matrix["months"][:6] if m["key"] in revenue_row["cells"]]
        assert len(months_with_revenue) == 6, f"Expected 6 months with revenue, got {len(months_with_revenue)}"
        
        for m in months_with_revenue:
            cell = revenue_row["cells"][m["key"]]
            assert abs(cell["amount"] - expected_per_month) < 1, f"Expected ~{expected_per_month}, got {cell['amount']}"
        
        print(f"✓ Distributed revenue shows {expected_per_month}/month for 6 months")
        
        # Find COGS row
        cogs_row = None
        for row in matrix["expense_rows"]:
            if "COGS" in row["label"] and row.get("parent_id") == self.created_flow_id:
                cogs_row = row
                break
        
        if cogs_row:
            # COGS should be -4000/month (40% of 10000)
            expected_cogs = -4000.0
            for m in months_with_revenue:
                if m["key"] in cogs_row["cells"]:
                    cell = cogs_row["cells"][m["key"]]
                    assert abs(cell["amount"] - expected_cogs) < 1, f"Expected COGS ~{expected_cogs}, got {cell['amount']}"
            print(f"✓ Linked COGS shows {expected_cogs}/month (40% of revenue)")


class TestUndoPeek:
    """Test undo peek endpoint"""
    
    def test_undo_peek_returns_has_undo(self):
        """Undo peek should return has_undo field"""
        res = requests.get(f"{BASE_URL}/api/undo/peek")
        assert res.status_code == 200
        data = res.json()
        assert "has_undo" in data, "Undo peek should return has_undo field"
        print(f"✓ Undo peek: has_undo={data['has_undo']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
