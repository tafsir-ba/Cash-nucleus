# Cash Piloting Dashboard - PRD

## Original Problem Statement
Forward-looking financial decision cockpit. Single user, no auth, CHF currency.
Consolidates bank accounts (state) and cash flows (events) into a deterministic projection engine.

## Core Constraint
**Single projection engine** — all views (chart, monthly breakdown, matrix table, P&L panel) read from the same computation path. No duplicate computation layers.

## What's Been Implemented

### Phase 1 — Foundation (April 2026)
- [x] KPI Cards: Cash Now, Goes Negative, Lowest Point, First Breach, Status
- [x] Scenario Toggle: Committed/Likely/Extended/Full
- [x] Flexible Horizon: 12M/24M/36M
- [x] Projection Chart with risk zones
- [x] Monthly Breakdown Table
- [x] Quick Add Form with linked flows
- [x] Entity Management and Entity Filter
- [x] Entry Log Dialog (CRUD)
- [x] Bank Accounts + Settings (safety buffer)
- [x] Linked Flows: Parent/child, dynamic % recalculation
- [x] Recurrence: Monthly/Quarterly, children inherit
- [x] Dark theme cockpit design, MongoDB persistence

### Phase 2 — Operational Realism (April 2026)
- [x] Recurrence Mode: Repeat vs Distribute (total split across periods, rounding preserved)
- [x] Flow Status system (replaced with Actuals in Phase 3)
- [x] Cash Flow Table (matrix view, tab-based)
- [x] P&L Panel with itemized flows

### Phase 3 — Control & Realism (April 2026)
- [x] **Recurrence Toggle (UI)**: Visible in main Quick Add form when recurrence selected. Per-period preview for distribute mode.
- [x] **Matrix Consistency**: Matrix table reads from `/api/projection/matrix` — same engine, verified exact match with chart/breakdown.
- [x] **Actuals & Variance**: Replaced paid/unpaid. Each occurrence: planned + actual. Variance: carry forward (creates carryover) or write off. Planned values never overwritten.
- [x] **Undo System**: Create/edit/delete/batch_create. Simple stack (last 50 actions). Linked flows undo as one coherent action.
- [x] **Entry Log Full Page Tab**: 3rd tab alongside Projection and Cash Flow Table. Full CRUD, search, category/type filters, parent/child grouping.
- [x] **Matrix UX**: Frozen first column, row/column hover highlight, row label click opens edit of source flow.

## Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + Recharts + @phosphor-icons/react + date-fns
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB (entities, bank_accounts, cash_flows, settings, flow_occurrences, undo_stack)

## Key API Endpoints
- GET /api/projection?scenario=&horizon=&entity_id=
- GET /api/projection/matrix?scenario=&horizon=&entity_id= (same engine)
- GET /api/month-details/{month} (includes planned_amount, actual_amount, variance_action)
- POST /api/cash-flows/batch (parent + linked)
- PUT /api/cash-flows/{id} (propagates to children)
- PUT /api/flow-occurrences (record actual, handle variance)
- DELETE /api/flow-occurrences (clear actual)
- POST /api/undo / GET /api/undo/peek

## Prioritized Backlog

### P1
- [ ] CSV import/export for data backup

### P2
- [ ] Historical comparison (vs last month)
- [ ] Custom category management

### P3
- [ ] What-If Simulator (sandboxed, no persistence)
- [ ] Keyboard shortcuts
- [ ] Mobile optimization
- [ ] Print-friendly reports

## Testing Status
- Iteration 6: Backend 21/21 (100%), Frontend 100%
- Cross-validation: Matrix net = Projection net (exact match verified)
