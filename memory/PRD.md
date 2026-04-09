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
- [x] Bank Accounts + Settings (safety buffer)
- [x] Linked Flows: Parent/child, dynamic % recalculation
- [x] Recurrence: Monthly/Quarterly, children inherit
- [x] Dark theme cockpit design, MongoDB persistence

### Phase 2 — Operational Realism (April 2026)
- [x] Recurrence Mode: Repeat vs Distribute
- [x] Cash Flow Table (matrix view)
- [x] P&L Panel with itemized flows

### Phase 3 — Control & Realism (April 2026)
- [x] Recurrence toggle visible in main form
- [x] Matrix reads from projection engine (verified exact match)
- [x] Actuals & Variance system (replaced paid/unpaid)
- [x] Undo System (create/edit/delete/batch)
- [x] Full-page Entry Log tab
- [x] Matrix UX (frozen column, hover, row click)

### Phase 3 Audit — Final Control (April 2026)
- [x] **Matrix-Based Actual Input**: Click any cell → record actual. Cyan 'A' indicator on cells with actuals. Supports carry forward / write off variance.
- [x] **Full Edit Parity**: Single canonical FlowEditor for both create and edit. All fields: description, entity, amount, date, category, certainty, recurrence, mode, count, linked flows.
- [x] **Carryover Cleanup**: No legacy paid/unpaid/auto-carryover. Carryover only via explicit variance carry_forward action.
- [x] **Matrix Row Totals**: "Total NM" column on right side, updates with horizon/filter/scenario.
- [x] **Matrix → Full Edit**: Row label click opens canonical FlowEditor.
- [x] **Cross-Validation**: Projection net = Matrix net = P&L net (verified with distributed revenue + linked COGS + actual < planned).

## Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + Recharts + @phosphor-icons/react + date-fns
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB (entities, bank_accounts, cash_flows, settings, flow_occurrences, undo_stack)

## Key API Endpoints
- GET /api/projection?scenario=&horizon=&entity_id=
- GET /api/projection/matrix?scenario=&horizon=&entity_id= (includes has_actual/actual/planned per cell)
- GET /api/month-details/{month} (includes planned_amount, actual_amount, variance_action)
- POST /api/cash-flows/batch | PUT /api/cash-flows/{id} | DELETE /api/cash-flows/{id}
- PUT /api/flow-occurrences (record actual + variance action)
- DELETE /api/flow-occurrences (clear actual)
- POST /api/undo | GET /api/undo/peek

## Prioritized Backlog

### P1
- [ ] CSV import/export for data backup

### P2
- [ ] Historical comparison
- [ ] Custom category management

### P3
- [ ] What-If Simulator (sandboxed)
- [ ] Keyboard shortcuts
- [ ] Mobile optimization

## Testing Status
- Iteration 7: Backend 24/24 (100%), Frontend 100%
- Cross-validation: Matrix net = Projection net (exact match verified for 12M and 24M)
- Legacy audit: No paid/unpaid/auto-carryover remnants found
