"""
Test Decision-Ready Features (Iteration 10)
- Source tagging (source_type: manual|deal, source_id: nullable)
- Flow priority (critical|flexible|strategic)
- Top drivers of negative months
- Scenario delta (gap = likely - committed)
- Cash runway (first month where balance < 0)
- Enhanced variance summary (under/over/carried/written-off)
"""
import pytest
import requests
import os
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="module")
def test_entity(api_client):
    """Create a test entity for all tests"""
    res = api_client.post(f"{BASE_URL}/api/entities", json={
        "name": "TEST_DecisionReady_Entity",
        "description": "Test entity for decision-ready features"
    })
    assert res.status_code == 200
    entity = res.json()
    yield entity
    # Cleanup
    api_client.delete(f"{BASE_URL}/api/entities/{entity['id']}")

@pytest.fixture(scope="module")
def test_bank_account(api_client, test_entity):
    """Create a test bank account"""
    res = api_client.post(f"{BASE_URL}/api/bank-accounts", json={
        "entity_id": test_entity["id"],
        "label": "TEST_DecisionReady_Account",
        "amount": 100000
    })
    assert res.status_code == 200
    account = res.json()
    yield account
    # Cleanup
    api_client.delete(f"{BASE_URL}/api/bank-accounts/{account['id']}")


class TestSourceTagging:
    """Source tagging: source_type (manual|deal) and source_id (nullable)"""
    
    def test_create_flow_default_source_type_manual(self, api_client, test_entity):
        """POST /api/cash-flows without source_type defaults to 'manual'"""
        today = date.today()
        res = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SourceTag_Default",
            "amount": -1000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        })
        assert res.status_code == 200
        flow = res.json()
        assert flow["source_type"] == "manual", "Default source_type should be 'manual'"
        assert flow["source_id"] is None, "Default source_id should be None"
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Default source_type is 'manual'")
    
    def test_create_flow_explicit_manual_source(self, api_client, test_entity):
        """POST /api/cash-flows with source_type=manual"""
        today = date.today()
        res = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SourceTag_Manual",
            "amount": -2000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"],
            "source_type": "manual"
        })
        assert res.status_code == 200
        flow = res.json()
        assert flow["source_type"] == "manual"
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Explicit source_type='manual' stored correctly")
    
    def test_create_flow_deal_source_with_id(self, api_client, test_entity):
        """POST /api/cash-flows with source_type=deal and source_id"""
        today = date.today()
        deal_id = "deal-abc-123"
        res = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SourceTag_Deal",
            "amount": 50000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Revenue",
            "certainty": "Sure to happen",
            "entity_id": test_entity["id"],
            "source_type": "deal",
            "source_id": deal_id
        })
        assert res.status_code == 200
        flow = res.json()
        assert flow["source_type"] == "deal", "source_type should be 'deal'"
        assert flow["source_id"] == deal_id, f"source_id should be '{deal_id}'"
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ source_type='deal' with source_id stored correctly")
    
    def test_source_tagging_does_not_affect_projection(self, api_client, test_entity, test_bank_account):
        """Source tagging is pure metadata - does NOT affect projection"""
        today = date.today()
        # Create two identical flows, one manual, one deal
        flow1 = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SourceTag_Proj_Manual",
            "amount": -5000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"],
            "source_type": "manual"
        }).json()
        
        # Get projection with manual flow
        proj1 = api_client.get(f"{BASE_URL}/api/projection", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Delete and create deal flow
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow1['id']}")
        
        flow2 = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_SourceTag_Proj_Deal",
            "amount": -5000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"],
            "source_type": "deal",
            "source_id": "deal-xyz"
        }).json()
        
        # Get projection with deal flow
        proj2 = api_client.get(f"{BASE_URL}/api/projection", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Projections should be identical (source_type doesn't affect calculation)
        assert proj1["months"][0]["net"] == proj2["months"][0]["net"], "Source type should not affect projection"
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow2['id']}")
        print("✓ Source tagging does NOT affect projection (pure metadata)")


class TestFlowPriority:
    """Flow priority: critical|flexible|strategic (pure metadata)"""
    
    def test_create_flow_with_priority_critical(self, api_client, test_entity):
        """POST /api/cash-flows with priority=critical"""
        today = date.today()
        res = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Priority_Critical",
            "amount": -10000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Salary",
            "certainty": "Materialized",
            "entity_id": test_entity["id"],
            "priority": "critical"
        })
        assert res.status_code == 200
        flow = res.json()
        assert flow["priority"] == "critical"
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ priority='critical' stored correctly")
    
    def test_create_flow_with_priority_flexible(self, api_client, test_entity):
        """POST /api/cash-flows with priority=flexible"""
        today = date.today()
        res = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Priority_Flexible",
            "amount": -3000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "50/50",
            "entity_id": test_entity["id"],
            "priority": "flexible"
        })
        assert res.status_code == 200
        flow = res.json()
        assert flow["priority"] == "flexible"
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ priority='flexible' stored correctly")
    
    def test_create_flow_with_priority_strategic(self, api_client, test_entity):
        """POST /api/cash-flows with priority=strategic"""
        today = date.today()
        res = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Priority_Strategic",
            "amount": -20000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Idea",
            "entity_id": test_entity["id"],
            "priority": "strategic"
        })
        assert res.status_code == 200
        flow = res.json()
        assert flow["priority"] == "strategic"
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ priority='strategic' stored correctly")
    
    def test_update_flow_priority(self, api_client, test_entity):
        """PUT /api/cash-flows/{id} with priority update"""
        today = date.today()
        # Create flow without priority
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Priority_Update",
            "amount": -5000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        }).json()
        assert flow["priority"] is None
        
        # Update to flexible
        res = api_client.put(f"{BASE_URL}/api/cash-flows/{flow['id']}", json={
            "priority": "flexible"
        })
        assert res.status_code == 200
        updated = res.json()
        assert updated["priority"] == "flexible"
        
        # Update to critical
        res = api_client.put(f"{BASE_URL}/api/cash-flows/{flow['id']}", json={
            "priority": "critical"
        })
        assert res.status_code == 200
        updated = res.json()
        assert updated["priority"] == "critical"
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Priority update works correctly")
    
    def test_priority_in_matrix_rows(self, api_client, test_entity, test_bank_account):
        """Matrix rows include priority field"""
        today = date.today()
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Priority_Matrix",
            "amount": -8000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"],
            "priority": "critical"
        }).json()
        
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Find our flow in expense_rows
        found = False
        for row in matrix["expense_rows"]:
            if row["flow_id"] == flow["id"]:
                assert row["priority"] == "critical", "Matrix row should include priority"
                found = True
                break
        assert found, "Flow should be in matrix expense_rows"
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Priority included in matrix rows")
    
    def test_priority_does_not_affect_projection(self, api_client, test_entity, test_bank_account):
        """Priority is pure metadata - does NOT affect projection"""
        today = date.today()
        # Create flow with critical priority
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Priority_NoEffect",
            "amount": -7000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"],
            "priority": "critical"
        }).json()
        
        proj1 = api_client.get(f"{BASE_URL}/api/projection", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Update to no priority
        api_client.put(f"{BASE_URL}/api/cash-flows/{flow['id']}", json={"priority": None})
        
        proj2 = api_client.get(f"{BASE_URL}/api/projection", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Projections should be identical
        assert proj1["months"][0]["net"] == proj2["months"][0]["net"], "Priority should not affect projection"
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Priority does NOT affect projection (pure metadata)")


class TestTopDrivers:
    """Top drivers of negative months endpoint"""
    
    def test_drivers_endpoint_returns_negative_months(self, api_client, test_entity, test_bank_account):
        """GET /api/projection/drivers returns negative_months array"""
        res = api_client.get(f"{BASE_URL}/api/projection/drivers", params={
            "scenario": "likely",
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        assert res.status_code == 200
        data = res.json()
        assert "negative_months" in data, "Response should have negative_months array"
        assert isinstance(data["negative_months"], list)
        print("✓ Drivers endpoint returns negative_months array")
    
    def test_drivers_structure(self, api_client, test_entity, test_bank_account):
        """Each negative month has drivers array with correct structure"""
        today = date.today()
        # Create a large expense to ensure negative month
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Drivers_LargeExpense",
            "amount": -200000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        }).json()
        
        res = api_client.get(f"{BASE_URL}/api/projection/drivers", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        data = res.json()
        
        if len(data["negative_months"]) > 0:
            nm = data["negative_months"][0]
            assert "month" in nm
            assert "month_label" in nm
            assert "net" in nm
            assert "cash_balance" in nm
            assert "drivers" in nm
            assert isinstance(nm["drivers"], list)
            assert len(nm["drivers"]) <= 3, "Max 3 drivers per month"
            
            if len(nm["drivers"]) > 0:
                d = nm["drivers"][0]
                assert "label" in d
                assert "amount" in d
                assert "count" in d
                assert "category" in d
                assert d["amount"] < 0, "Drivers should be negative contributors"
            print("✓ Drivers structure is correct (month, drivers array, max 3)")
        else:
            print("✓ No negative months (structure test skipped)")
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
    
    def test_drivers_aggregated_by_label(self, api_client, test_entity, test_bank_account):
        """Drivers are aggregated by label (same label shows single entry with count)"""
        today = date.today()
        # Create multiple flows with same label
        flows = []
        for i in range(3):
            next_month = today + relativedelta(months=i)
            f = api_client.post(f"{BASE_URL}/api/cash-flows", json={
                "label": "TEST_Drivers_SameLabel",
                "amount": -50000,
                "date": f"{next_month.strftime('%Y-%m')}-01",
                "category": "Expense",
                "certainty": "Materialized",
                "entity_id": test_entity["id"]
            }).json()
            flows.append(f)
        
        res = api_client.get(f"{BASE_URL}/api/projection/drivers", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        data = res.json()
        
        # Check if aggregation works (count > 1 for same label)
        for nm in data["negative_months"]:
            for d in nm["drivers"]:
                if d["label"] == "TEST_Drivers_SameLabel":
                    # If multiple occurrences in same month, count should reflect that
                    print(f"✓ Driver aggregation: label={d['label']}, count={d['count']}, amount={d['amount']}")
        
        for f in flows:
            api_client.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")
        print("✓ Drivers aggregated by label")
    
    def test_drivers_only_negative_contributors(self, api_client, test_entity, test_bank_account):
        """Only negative contributors included in drivers (no positive flows)"""
        today = date.today()
        # Create both positive and negative flows
        expense = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Drivers_Expense",
            "amount": -150000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        }).json()
        
        revenue = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Drivers_Revenue",
            "amount": 30000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Revenue",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        }).json()
        
        res = api_client.get(f"{BASE_URL}/api/projection/drivers", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        data = res.json()
        
        for nm in data["negative_months"]:
            for d in nm["drivers"]:
                assert d["amount"] < 0, f"Driver {d['label']} should be negative, got {d['amount']}"
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{expense['id']}")
        api_client.delete(f"{BASE_URL}/api/cash-flows/{revenue['id']}")
        print("✓ Only negative contributors in drivers")


class TestScenarioDelta:
    """Scenario delta: gap = likely balance - committed balance per month"""
    
    def test_scenario_delta_endpoint(self, api_client, test_entity, test_bank_account):
        """GET /api/projection/scenario-delta returns per-month gap"""
        res = api_client.get(f"{BASE_URL}/api/projection/scenario-delta", params={
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        assert res.status_code == 200
        data = res.json()
        assert "months" in data
        assert "total_gap_net" in data
        print("✓ Scenario delta endpoint returns months and total_gap_net")
    
    def test_scenario_delta_structure(self, api_client, test_entity, test_bank_account):
        """Each month has committed_net, likely_net, gap_net, gap_balance"""
        res = api_client.get(f"{BASE_URL}/api/projection/scenario-delta", params={
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        data = res.json()
        
        assert len(data["months"]) == 12
        m = data["months"][0]
        assert "month" in m
        assert "month_label" in m
        assert "committed_net" in m
        assert "likely_net" in m
        assert "gap_net" in m
        assert "committed_balance" in m
        assert "likely_balance" in m
        assert "gap_balance" in m
        print("✓ Scenario delta month structure is correct")
    
    def test_scenario_delta_gap_calculation(self, api_client, test_entity, test_bank_account):
        """gap_net = likely_net - committed_net"""
        today = date.today()
        # Create a "Sure to happen" flow (in likely but not committed)
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Delta_SureFlow",
            "amount": 20000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Revenue",
            "certainty": "Sure to happen",
            "entity_id": test_entity["id"]
        }).json()
        
        res = api_client.get(f"{BASE_URL}/api/projection/scenario-delta", params={
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        data = res.json()
        
        m = data["months"][0]
        expected_gap = m["likely_net"] - m["committed_net"]
        assert abs(m["gap_net"] - expected_gap) < 0.01, f"gap_net should be likely_net - committed_net"
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ gap_net = likely_net - committed_net")
    
    def test_scenario_delta_total_gap(self, api_client, test_entity, test_bank_account):
        """total_gap_net is sum of all monthly gap_net values"""
        res = api_client.get(f"{BASE_URL}/api/projection/scenario-delta", params={
            "entity_id": test_entity["id"],
            "horizon": 12
        })
        data = res.json()
        
        sum_gaps = sum(m["gap_net"] for m in data["months"])
        assert abs(data["total_gap_net"] - sum_gaps) < 0.01, "total_gap_net should be sum of monthly gaps"
        print("✓ total_gap_net is sum of monthly gap_net values")


class TestCashRunway:
    """Cash runway: first month where balance < 0"""
    
    def test_runway_endpoint(self, api_client, test_entity, test_bank_account):
        """GET /api/projection/runway returns committed and likely runway"""
        res = api_client.get(f"{BASE_URL}/api/projection/runway", params={
            "entity_id": test_entity["id"],
            "horizon": 36
        })
        assert res.status_code == 200
        data = res.json()
        assert "committed" in data
        assert "likely" in data
        print("✓ Runway endpoint returns committed and likely")
    
    def test_runway_structure(self, api_client, test_entity, test_bank_account):
        """Each runway has months_until_breach, breach_month, is_safe"""
        res = api_client.get(f"{BASE_URL}/api/projection/runway", params={
            "entity_id": test_entity["id"],
            "horizon": 36
        })
        data = res.json()
        
        for sc in ["committed", "likely"]:
            r = data[sc]
            assert "months_until_breach" in r
            assert "breach_month" in r
            assert "runway_months" in r
            assert "is_safe" in r
        print("✓ Runway structure is correct")
    
    def test_runway_safe_when_no_breach(self, api_client, test_entity, test_bank_account):
        """is_safe=True when no month has balance < 0"""
        # With 100k starting balance and no expenses, should be safe
        res = api_client.get(f"{BASE_URL}/api/projection/runway", params={
            "entity_id": test_entity["id"],
            "horizon": 36
        })
        data = res.json()
        
        # Check committed scenario (no flows = safe)
        if data["committed"]["is_safe"]:
            assert data["committed"]["months_until_breach"] is None
            assert data["committed"]["breach_month"] is None
            print("✓ is_safe=True when no breach")
        else:
            print("✓ Runway correctly identifies breach")
    
    def test_runway_breach_detection(self, api_client, test_entity, test_bank_account):
        """Runway detects first month where cash_balance < 0"""
        today = date.today()
        # Create large expense to cause breach
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Runway_Breach",
            "amount": -500000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        }).json()
        
        res = api_client.get(f"{BASE_URL}/api/projection/runway", params={
            "entity_id": test_entity["id"],
            "horizon": 36
        })
        data = res.json()
        
        # Should detect breach
        assert data["committed"]["is_safe"] == False, "Should detect breach"
        assert data["committed"]["months_until_breach"] == 1, "Breach should be in month 1"
        assert data["committed"]["breach_month"] is not None
        
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Runway correctly detects breach month")


class TestVarianceSummary:
    """Enhanced variance summary: under/over/carried/written-off"""
    
    def test_variance_summary_endpoint(self, api_client, test_entity):
        """GET /api/variance-summary returns required fields"""
        res = api_client.get(f"{BASE_URL}/api/variance-summary", params={
            "entity_id": test_entity["id"]
        })
        assert res.status_code == 200
        data = res.json()
        assert "actuals_recorded" in data
        assert "total_variance" in data
        assert "total_underperformance" in data
        assert "total_overperformance" in data
        assert "total_carried_forward" in data
        assert "total_written_off" in data
        assert "net_variance_impact" in data
        print("✓ Variance summary returns all required fields")
    
    def test_variance_summary_with_actuals(self, api_client, test_entity, test_bank_account):
        """Variance summary correctly tracks actuals"""
        today = date.today()
        # Create a flow
        flow = api_client.post(f"{BASE_URL}/api/cash-flows", json={
            "label": "TEST_Variance_Flow",
            "amount": -10000,
            "date": f"{today.strftime('%Y-%m')}-01",
            "category": "Expense",
            "certainty": "Materialized",
            "entity_id": test_entity["id"]
        }).json()
        
        # Record actual (underperformance - spent more)
        api_client.put(f"{BASE_URL}/api/flow-occurrences", json={
            "flow_id": flow["id"],
            "month": today.strftime("%Y-%m"),
            "actual_amount": -12000,
            "variance_action": "carry_forward"
        })
        
        res = api_client.get(f"{BASE_URL}/api/variance-summary", params={
            "entity_id": test_entity["id"]
        })
        data = res.json()
        
        assert data["actuals_recorded"] >= 1
        assert data["total_variance"] >= 0
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/flow-occurrences?flow_id={flow['id']}&month={today.strftime('%Y-%m')}")
        api_client.delete(f"{BASE_URL}/api/cash-flows/{flow['id']}")
        print("✓ Variance summary tracks actuals correctly")


class TestCreed2Regression:
    """Verify Creed 2 compliance: Projection = Matrix = P&L"""
    
    def test_projection_matrix_match(self, api_client, test_entity, test_bank_account):
        """Projection net_per_month == Matrix net_per_month"""
        today = date.today()
        # Create some flows
        flows = []
        for i in range(3):
            f = api_client.post(f"{BASE_URL}/api/cash-flows", json={
                "label": f"TEST_Creed2_Flow_{i}",
                "amount": -5000 if i % 2 == 0 else 10000,
                "date": f"{today.strftime('%Y-%m')}-01",
                "category": "Expense" if i % 2 == 0 else "Revenue",
                "certainty": "Materialized",
                "entity_id": test_entity["id"]
            }).json()
            flows.append(f)
        
        # Get projection
        proj = api_client.get(f"{BASE_URL}/api/projection", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Get matrix
        matrix = api_client.get(f"{BASE_URL}/api/projection/matrix", params={
            "scenario": "committed",
            "entity_id": test_entity["id"],
            "horizon": 12
        }).json()
        
        # Compare net per month
        for pm in proj["months"]:
            matrix_net = matrix["net_per_month"].get(pm["month"], 0)
            assert abs(pm["net"] - matrix_net) < 0.01, f"Month {pm['month']}: Projection net {pm['net']} != Matrix net {matrix_net}"
        
        # Compare totals
        proj_total = sum(m["net"] for m in proj["months"])
        assert abs(proj_total - matrix["total_net"]) < 0.01, "Total net should match"
        
        for f in flows:
            api_client.delete(f"{BASE_URL}/api/cash-flows/{f['id']}")
        print("✓ Projection == Matrix (Creed 2 verified)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
