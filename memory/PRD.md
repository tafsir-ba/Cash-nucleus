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
- **Cash Flows**: id, entity_id, label, amount, date, category, certainty, recurrence, recurrence_end, recurrence_count, parent_id, is_percentage, percentage_of_parent
- **Settings**: safety_buffer

## What's Been Implemented (April 2026)
- [x] KPI Cards: Cash Now, Goes Negative (First Danger Month), Lowest Point, First Breach, Status
- [x] Scenario Toggle: Committed/Likely/Extended/Full
- [x] Flexible Horizon: 12M/24M/36M selector
- [x] Projection Chart with auto-scaled risk zones (Safe/Watch/Danger)
- [x] Monthly P&L Panel (Revenue vs Costs vs Net on month click)
- [x] Monthly Breakdown Table
- [x] Quick Add Form with inflow/outflow toggle, linked flows, recurrence
- [x] Entity Management and Entity Filter
- [x] Entry Log Dialog with full CRUD (view, edit, delete, linked flow awareness)
- [x] Bank Accounts Dialog (CRUD)
- [x] Settings Dialog (safety buffer)
- [x] Linked Flows: Parent/child with dynamic percentage recalculation
- [x] Recurrence: Monthly and Quarterly (children inherit parent recurrence)
- [x] Dark theme financial cockpit design
- [x] MongoDB persistence
- [x] All backend APIs with projection engine
- [x] Dialog accessibility (DialogDescription on all dialogs)

## Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + Recharts + @phosphor-icons/react + date-fns
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB (entities, bank_accounts, cash_flows, settings collections)

## Prioritized Backlog

### P0 (Critical) - None remaining

### P1 (High Priority)
- [ ] Bulk import/export (CSV) for data backup/restore
- [ ] Data backup/restore mechanism

### P2 (Medium Priority)
- [ ] Historical comparison (vs last month/year)
- [ ] Custom category management
- [ ] Monthly summary notifications

### P3 (Nice to Have)
- [ ] Keyboard shortcuts for quick add
- [ ] Dark/light theme toggle
- [ ] Mobile responsive optimization
- [ ] Print-friendly report view

## Testing Status
- Backend: 21/21 tests passed (iteration 4)
- Frontend: 100% pass rate (iteration 4)
- All features verified via testing agent (iterations 1-4)
