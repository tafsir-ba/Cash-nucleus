#!/usr/bin/env python3
"""
Backend API Testing for Cash Piloting Dashboard
Tests all CRUD operations and projection endpoints including Entity management
"""

import requests
import sys
import json
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

class CashPilotAPITester:
    def __init__(self, base_url="https://cash-risk-map.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.created_entities = []
        self.created_accounts = []
        self.created_flows = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        return success

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                try:
                    return self.log_test(name, True), response.json()
                except:
                    return self.log_test(name, True), {}
            else:
                return self.log_test(name, False, f"Expected {expected_status}, got {response.status_code}"), {}

        except Exception as e:
            return self.log_test(name, False, f"Error: {str(e)}"), {}

    def test_root_endpoint(self):
        """Test root API endpoint"""
        return self.run_test("Root API endpoint", "GET", "", 200)

    def test_entities_crud(self):
        """Test entities CRUD operations"""
        print("\n🏢 Testing Entities CRUD...")
        
        # 1. Get initial entities
        success, entities = self.run_test("Get entities", "GET", "entities", 200)
        if not success:
            return False
        
        initial_count = len(entities)
        
        # 2. Create an entity
        entity_data = {
            "name": f"Test Entity {datetime.now().strftime('%H%M%S')}",
            "description": "Test entity for API testing"
        }
        success, created_entity = self.run_test("Create entity", "POST", "entities", 200, entity_data)
        if not success:
            return False
        
        entity_id = created_entity.get("id")
        if entity_id:
            self.created_entities.append(entity_id)
        
        # 3. Update the entity
        update_data = {
            "name": f"Updated Test Entity {datetime.now().strftime('%H%M%S')}",
            "description": "Updated description"
        }
        success, updated_entity = self.run_test("Update entity", "PUT", f"entities/{entity_id}", 200, update_data)
        if not success:
            return False
        
        # 4. Get entities again (should have one more)
        success, entities = self.run_test("Get entities after create", "GET", "entities", 200)
        if not success or len(entities) != initial_count + 1:
            self.log_test("Entity count verification", False, f"Expected {initial_count + 1}, got {len(entities)}")
            return False
        self.log_test("Entity count verification", True)
        
        return True

    def test_bank_accounts_crud(self):
        """Test bank accounts CRUD operations"""
        print("\n🏦 Testing Bank Accounts CRUD...")
        
        if not self.created_entities:
            self.log_test("Bank accounts test", False, "No entities available")
            return False
        
        entity_id = self.created_entities[0]
        
        # 1. Get initial accounts (should be empty or existing)
        success, accounts = self.run_test("Get bank accounts", "GET", "bank-accounts", 200)
        if not success:
            return False
        
        initial_count = len(accounts)
        
        # 2. Create a bank account
        account_data = {
            "label": "Test Checking Account",
            "amount": 25000.50,
            "entity_id": entity_id
        }
        success, created_account = self.run_test("Create bank account", "POST", "bank-accounts", 200, account_data)
        if not success:
            return False
        
        account_id = created_account.get("id")
        if account_id:
            self.created_accounts.append(account_id)
        
        # 3. Test creating account with invalid entity
        invalid_data = {
            "label": "Invalid Account",
            "amount": 1000.0,
            "entity_id": "invalid-entity-id"
        }
        success, _ = self.run_test("Create account with invalid entity", "POST", "bank-accounts", 400, invalid_data)
        if success:
            self.log_test("Invalid entity rejection", True)
        else:
            self.log_test("Invalid entity rejection", False, "Should have rejected invalid entity_id")
        
        # 3. Get accounts again (should have one more)
        success, accounts = self.run_test("Get bank accounts after create", "GET", "bank-accounts", 200)
        if not success or len(accounts) != initial_count + 1:
            self.log_test("Account count verification", False, f"Expected {initial_count + 1}, got {len(accounts)}")
            return False
        self.log_test("Account count verification", True)
        
        # 4. Update the account
        update_data = {
            "label": "Updated Test Account",
            "amount": 30000.00
        }
        success, updated_account = self.run_test("Update bank account", "PUT", f"bank-accounts/{account_id}", 200, update_data)
        if not success:
            return False
        
        # 5. Verify update
        if updated_account.get("label") == "Updated Test Account" and updated_account.get("amount") == 30000.00:
            self.log_test("Account update verification", True)
        else:
            self.log_test("Account update verification", False, "Updated values don't match")
            return False
        
        return True

    def test_cash_flows_crud(self):
        """Test cash flows CRUD operations"""
        print("\n💰 Testing Cash Flows CRUD...")
        
        if not self.created_entities:
            self.log_test("Cash flows test", False, "No entities available")
            return False
        
        entity_id = self.created_entities[0]
        
        # 1. Get initial flows
        success, flows = self.run_test("Get cash flows", "GET", "cash-flows", 200)
        if not success:
            return False
        
        initial_count = len(flows)
        
        # 2. Create an inflow
        current_month = date.today().replace(day=1)
        inflow_data = {
            "label": "Test Salary",
            "amount": 5000.00,
            "date": current_month.isoformat(),
            "category": "Salary",
            "certainty": "Materialized",
            "recurrence": "none",
            "entity_id": entity_id
        }
        success, created_flow = self.run_test("Create cash inflow", "POST", "cash-flows", 200, inflow_data)
        if not success:
            return False
        
        flow_id = created_flow.get("id")
        if flow_id:
            self.created_flows.append(flow_id)
        
        # 3. Create an outflow
        outflow_data = {
            "label": "Test Rent",
            "amount": -2000.00,
            "date": current_month.isoformat(),
            "category": "Expense",
            "certainty": "Sure to happen",
            "recurrence": "monthly",
            "recurrence_count": 12,
            "entity_id": entity_id
        }
        success, created_outflow = self.run_test("Create cash outflow", "POST", "cash-flows", 200, outflow_data)
        if not success:
            return False
        
        outflow_id = created_outflow.get("id")
        if outflow_id:
            self.created_flows.append(outflow_id)
        
        # 4. Test creating flow with invalid entity
        invalid_flow = {
            "label": "Invalid Flow",
            "amount": -1000.0,
            "date": current_month.isoformat(),
            "entity_id": "invalid-entity-id"
        }
        success, _ = self.run_test("Create flow with invalid entity", "POST", "cash-flows", 400, invalid_flow)
        if success:
            self.log_test("Invalid entity rejection for flow", True)
        
        # 5. Get flows again (should have two more)
        success, flows = self.run_test("Get cash flows after create", "GET", "cash-flows", 200)
        if not success or len(flows) != initial_count + 2:
            self.log_test("Flow count verification", False, f"Expected {initial_count + 2}, got {len(flows)}")
            return False
        self.log_test("Flow count verification", True)
        
        # 6. Update a flow
        update_data = {
            "label": "Updated Test Salary",
            "amount": 5500.00
        }
        success, updated_flow = self.run_test("Update cash flow", "PUT", f"cash-flows/{flow_id}", 200, update_data)
        if not success:
            return False
        
        # 7. Verify update
        if updated_flow.get("label") == "Updated Test Salary" and updated_flow.get("amount") == 5500.00:
            self.log_test("Flow update verification", True)
        else:
            self.log_test("Flow update verification", False, "Updated values don't match")
            return False
        
        return True

    def test_linked_flows(self):
        """Test linked flows (batch creation)"""
        print("\n🔗 Testing Linked Flows...")
        
        if not self.created_entities:
            self.log_test("Linked flows test", False, "No entities available")
            return False
        
        entity_id = self.created_entities[0]
        
        # 1. Create batch with parent and linked flows
        batch_data = {
            "parent": {
                "label": f"Parent Revenue {datetime.now().strftime('%H%M%S')}",
                "amount": 10000.0,
                "date": "2024-12-01",
                "category": "Revenue",
                "certainty": "Materialized",
                "recurrence": "none",
                "entity_id": entity_id
            },
            "linked": [
                {
                    "label": f"COGS {datetime.now().strftime('%H%M%S')}",
                    "amount": -3000.0,
                    "date": "2024-12-01",
                    "category": "COGS",
                    "certainty": "Materialized",
                    "recurrence": "none",
                    "entity_id": entity_id
                },
                {
                    "label": f"Tax {datetime.now().strftime('%H%M%S')}",
                    "amount": -1000.0,
                    "date": "2024-12-01",
                    "category": "Tax",
                    "certainty": "Materialized",
                    "recurrence": "none",
                    "entity_id": entity_id
                }
            ]
        }
        success, batch_result = self.run_test("Create batch flows", "POST", "cash-flows/batch", 200, batch_data)
        if not success:
            return False
        
        parent_id = batch_result.get('parent', {}).get('id')
        if parent_id:
            self.created_flows.append(parent_id)
        
        linked_flows = batch_result.get('linked', [])
        for linked in linked_flows:
            if linked.get('id'):
                self.created_flows.append(linked['id'])
        
        # 2. Get flows with linked structure
        success, flows_with_linked = self.run_test("Get flows with linked", "GET", "cash-flows/with-linked", 200)
        if not success:
            return False
        
        # Verify the structure
        found_parent = False
        for flow_group in flows_with_linked:
            if flow_group.get('flow', {}).get('id') == parent_id:
                found_parent = True
                linked_count = len(flow_group.get('linked_flows', []))
                if linked_count == 2:
                    self.log_test("Linked flows structure verification", True)
                else:
                    self.log_test("Linked flows structure verification", False, f"Expected 2 linked flows, found {linked_count}")
                break
        
        if not found_parent:
            self.log_test("Parent flow in linked structure", False, "Parent flow not found")
        
        return True

    def test_settings(self):
        """Test settings endpoints"""
        print("\n⚙️ Testing Settings...")
        
        # 1. Get current settings
        success, settings = self.run_test("Get settings", "GET", "settings", 200)
        if not success:
            return False
        
        original_buffer = settings.get("safety_buffer", 50000)
        
        # 2. Update settings
        new_buffer = 75000.0
        update_data = {"safety_buffer": new_buffer}
        success, updated_settings = self.run_test("Update settings", "PUT", "settings", 200, update_data)
        if not success:
            return False
        
        # 3. Verify update
        if updated_settings.get("safety_buffer") == new_buffer:
            self.log_test("Settings update verification", True)
        else:
            self.log_test("Settings update verification", False, f"Expected {new_buffer}, got {updated_settings.get('safety_buffer')}")
            return False
        
        # 4. Restore original settings
        restore_data = {"safety_buffer": original_buffer}
        success, _ = self.run_test("Restore original settings", "PUT", "settings", 200, restore_data)
        return success

    def test_projection(self):
        """Test projection endpoint with different scenarios"""
        print("\n📊 Testing Projection...")
        
        scenarios = ["committed", "likely", "extended", "full"]
        
        for scenario in scenarios:
            success, projection = self.run_test(f"Get {scenario} projection", "GET", "projection", 200, params={"scenario": scenario})
            if not success:
                return False
            
            # Verify projection structure
            required_fields = ["cash_now", "lowest_cash", "lowest_cash_month", "highest_pressure_month", "overall_status", "safety_buffer", "months"]
            missing_fields = [field for field in required_fields if field not in projection]
            
            if missing_fields:
                self.log_test(f"Projection {scenario} structure", False, f"Missing fields: {missing_fields}")
                return False
            else:
                self.log_test(f"Projection {scenario} structure", True)
            
            # Verify months array
            months = projection.get("months", [])
            if len(months) != 12:
                self.log_test(f"Projection {scenario} months count", False, f"Expected 12 months, got {len(months)}")
                return False
            else:
                self.log_test(f"Projection {scenario} months count", True)
            
            # Verify month structure
            if months:
                month = months[0]
                month_fields = ["month", "month_label", "inflows", "outflows", "net", "closing_cash", "status"]
                missing_month_fields = [field for field in month_fields if field not in month]
                
                if missing_month_fields:
                    self.log_test(f"Month structure {scenario}", False, f"Missing fields: {missing_month_fields}")
                    return False
                else:
                    self.log_test(f"Month structure {scenario}", True)
        
        return True

    def test_month_details(self):
        """Test month details endpoint"""
        print("\n📅 Testing Month Details...")
        
        # Test current month
        current_month = date.today().strftime("%Y-%m")
        
        scenarios = ["likely", "full"]
        for scenario in scenarios:
            success, details = self.run_test(f"Get month details {current_month} ({scenario})", "GET", f"month-details/{current_month}", 200, params={"scenario": scenario})
            if not success:
                return False
            
            # Verify structure
            required_fields = ["month", "top_outflows", "recurring_burdens", "all_flows"]
            missing_fields = [field for field in required_fields if field not in details]
            
            if missing_fields:
                self.log_test(f"Month details {scenario} structure", False, f"Missing fields: {missing_fields}")
                return False
            else:
                self.log_test(f"Month details {scenario} structure", True)
        
        return True

    def cleanup(self):
        """Clean up created test data"""
        print("\n🧹 Cleaning up test data...")
        
        # Delete created cash flows first (they depend on entities)
        for flow_id in self.created_flows:
            success, _ = self.run_test(f"Delete flow {flow_id}", "DELETE", f"cash-flows/{flow_id}", 200)
        
        # Delete created bank accounts (they depend on entities)
        for account_id in self.created_accounts:
            success, _ = self.run_test(f"Delete account {account_id}", "DELETE", f"bank-accounts/{account_id}", 200)
        
        # Delete created entities last
        for entity_id in self.created_entities:
            success, _ = self.run_test(f"Delete entity {entity_id}", "DELETE", f"entities/{entity_id}", 200)

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting Cash Pilot API Tests...")
        print(f"Testing against: {self.base_url}")
        
        try:
            # Test basic connectivity
            if not self.test_root_endpoint()[0]:
                print("❌ Cannot connect to API. Stopping tests.")
                return False
            
            # Run all test suites
            test_suites = [
                self.test_entities_crud,
                self.test_bank_accounts_crud,
                self.test_cash_flows_crud,
                self.test_linked_flows,
                self.test_settings,
                self.test_projection,
                self.test_month_details
            ]
            
            all_passed = True
            for test_suite in test_suites:
                if not test_suite():
                    all_passed = False
            
            return all_passed
            
        finally:
            # Always cleanup
            self.cleanup()

    def print_summary(self):
        """Print test summary"""
        print(f"\n📊 Test Summary:")
        print(f"Tests run: {self.tests_run}")
        print(f"Tests passed: {self.tests_passed}")
        print(f"Tests failed: {self.tests_run - self.tests_passed}")
        print(f"Success rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "No tests run")
        
        return self.tests_passed == self.tests_run

def main():
    """Main test runner"""
    tester = CashPilotAPITester()
    
    try:
        success = tester.run_all_tests()
        tester.print_summary()
        
        if success:
            print("\n🎉 All API tests passed!")
            return 0
        else:
            print("\n💥 Some API tests failed!")
            return 1
            
    except KeyboardInterrupt:
        print("\n⏹️ Tests interrupted by user")
        return 1
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())