# Cash Piloting Dashboard - PRD

## Original Problem Statement
Design a consolidated cash piloting dashboard that allows a single user to:
- Understand their current real cash
- Visualize their future cash trajectory (12/24/36 months)
- Instantly determine whether they are in a safe, pressure, or danger zone

The tool is a forward-looking decision cockpit, not accounting software.

## User Personas
**Primary User**: Business owner/CFO who needs to quickly assess cash position and future risks without complex accounting interfaces.

## Core Requirements (Static)
1. **Cash Now Display**: Sum of all bank accounts
2. **Flexible Horizon Projection**: 12/24/36-month cash trajectory with scenario filtering
3. **Risk Zones**: Good (above buffer), Watch (0 to buffer), Danger (below 0)
4. **Scenario Toggle**: Committed/Likely/Extended/Full certainty levels
5. **Quick Add**: ≤3 seconds to add a cash flow entry
6. **CHF Currency Only**
7. **No authentication** (single user)
8. **Single Source of Truth**: Bank accounts = state, Cash Flows = events. Projection engine computes dynamically.

## Data Model
- **Entities**: id, name, description
- **Bank Accounts**: id, entity_id, label, amount
- **Cash Flows**: id, entity_id, label, amount, date, category, certainty, recurrence, recurrence_mode (repeat/distribute), recurrence_end, recurrence_count, parent_id, is_percentage, percentage_of_parent, carryover_from, carryover_month
- **Flow Occurrences**: id, flow_id, month, status (planned/paid/unpaid)
- **Settings**: safety_buffer

## What's Been Implemented

### Phase 1 (April 2026)
- [x] KPI Cards: Cash Now, Goes Negative, Lowest Point, First Breach, Status
- [x] Scenario Toggle: Committed/Likely/Extended/Full
- [x] Flexible Horizon: 12M/24M/36M selector
- [x] Projection Chart with auto-scaled risk zones
- [x] Monthly Breakdown Table
- [x] Quick Add Form with linked flows, recurrence
- [x] Entity Management and Entity Filter
- [x] Entry Log Dialog with full CRUD
- [x] Bank Accounts Dialog (CRUD)
- [x] Settings Dialog (safety buffer)
- [x] Linked Flows: Parent/child with dynamic percentage recalculation
- [x] Recurrence: Monthly and Quarterly (children inherit parent recurrence)
- [x] Monthly P&L Panel
- [x] Dark theme financial cockpit design
- [x] MongoDB persistence
- [x] Dialog accessibility

### Phase 2 (April 2026) — Operational Realism
- [x] **Recurrence Mode: Repeat vs Distribute** — Total amount split across periods with proper rounding (last period adjustment). Children inherit mode. Per-period preview in Quick Add.
- [x] **Flow Status + Carryover Logic** — Each occurrence: Planned/Paid/Unpaid. Unpaid auto-creates carryover in next month (preserves amount, entity). Carryover stacks with recurring flows. Projection skips unpaid occurrences.
- [x] **Cash Flow Table (Matrix View)** — Tab-based view. Rows = flows, Columns = months. Revenues on top, Expenses below, Net P/L row. Clickable cells open edit dialog. Synced with projection engine.
- [x] **P&L Panel Enhancement** — Itemized flows under Revenue/Costs sections. Status buttons for each flow (planned/paid/unpaid cycling). Carryover indicator.

## Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + Recharts + @phosphor-icons/react + date-fns
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB (entities, bank_accounts, cash_flows, settings, flow_occurrences)

## Key API Endpoints
- GET /api/projection?scenario=&horizon=&entity_id=
- POST /api/cash-flows/batch (parent + linked)
- PUT /api/cash-flows/{id} (propagates to children)
- PUT /api/flow-occurrences (set status, auto-carryover)
- GET /api/flow-occurrences?month=&flow_id=
- GET /api/month-details/{month} (includes flow_id, status, is_carryover)

## Prioritized Backlog

### P1 (High Priority)
- [ ] Bulk import/export (CSV) for data backup/restore
- [ ] Data backup/restore mechanism

### P2 (Medium Priority)
- [ ] Historical comparison (vs last month/year)
- [ ] Custom category management

### P3 (Nice to Have)
- [ ] Keyboard shortcuts for quick add
- [ ] Dark/light theme toggle
- [ ] Mobile responsive optimization
- [ ] Print-friendly report view

## Testing Status
- Iteration 5: Backend 37/37 (100%), Frontend 100%
- All features verified via testing agent
