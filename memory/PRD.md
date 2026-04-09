# Cash Piloting Dashboard - PRD

## Original Problem Statement
Design a consolidated cash piloting dashboard that allows a single user to:
- Understand their current real cash
- Visualize their future cash trajectory (12 months)
- Instantly determine whether they are in a safe, pressure, or danger zone

The tool is a forward-looking decision cockpit, not accounting software.

## User Personas
**Primary User**: Business owner/CFO who needs to quickly assess cash position and future risks without complex accounting interfaces.

## Core Requirements (Static)
1. **Cash Now Display**: Sum of all bank accounts
2. **12-Month Projection**: Monthly cash trajectory with scenario filtering
3. **Risk Zones**: Good (above buffer), Watch (0 to buffer), Danger (below 0)
4. **Scenario Toggle**: Committed/Likely/Extended/Full certainty levels
5. **Quick Add**: ≤3 seconds to add a cash flow entry
6. **CHF Currency Only**
7. **No authentication (single user)

## Data Model
- **Bank Accounts**: entity, label, amount (state - defines Cash Now)
- **Cash Flows**: label, amount, date, category, certainty, recurrence, entity
- **Settings**: safety_buffer

## What's Been Implemented (April 2026)
- [x] KPI Cards: Cash Now, Lowest Point, Pressure Month, Status
- [x] Scenario Toggle: Committed/Likely/Extended/Full
- [x] 12-Month Projection Chart with risk zones
- [x] Monthly Breakdown Table
- [x] Quick Add Form with inflow/outflow toggle
- [x] Pressure Panel with month analysis
- [x] Bank Accounts Dialog (CRUD)
- [x] Settings Dialog (safety buffer)
- [x] Cash Flows Dialog (view/delete)
- [x] Dark theme financial cockpit design
- [x] MongoDB persistence
- [x] All backend APIs

## Prioritized Backlog

### P0 (Critical) - None remaining

### P1 (High Priority)
- [ ] Edit cash flow functionality (currently only delete)
- [ ] Bulk import/export (CSV)
- [ ] Data backup/restore

### P2 (Medium Priority)
- [ ] Entity filtering (view by company/entity)
- [ ] Monthly summary email notifications
- [ ] Historical comparison (vs last month/year)
- [ ] Custom category management

### P3 (Nice to Have)
- [ ] Keyboard shortcuts for quick add
- [ ] Dark/light theme toggle
- [ ] Mobile responsive optimization
- [ ] Print-friendly report view

## Next Tasks
1. Add edit functionality for existing cash flows
2. Implement CSV import for bulk data entry
3. Add entity-based filtering view
