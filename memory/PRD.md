# Cash Piloting Dashboard - PRD

## Original Problem Statement
Forward-looking financial decision cockpit. Single user, no auth, CHF currency.
Consolidates bank accounts (state) and cash flows (events) into a deterministic projection engine.

## Core Constraint
**Single projection engine** — all views (chart, monthly breakdown, matrix table, P&L panel) read from the same computation path. No duplicate computation layers. Frontend performs ZERO mathematical operations on projection data.

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
- [x] Undo System (create/edit/delete/batch/record_actual)
- [x] Full-page Entry Log tab
- [x] Matrix UX (frozen column, hover, row click)

### Phase 3 Audit — Final Control (April 2026)
- [x] Semantic Actuals Visibility: Cells show actual (cyan), planned (strikethrough), variance delta
- [x] Single Scroll Container: Header/body/totals in one table, no desync
- [x] Explicit Carry-Forward/Write-Off Confirmation with undo hint
- [x] Backend-Driven Totals: revenue_per_month, cost_per_month, cash_balance_per_month, net_per_month

### Final Control & Trust Lock (April 2026)
- [x] **Undo Full Dependency Graph**: Restores exact prior state including planned_amount, actual_amount, variance decision, carryover flows, linked flow recalculations. Orphaned children parent_id restored on delete undo.
- [x] **Matrix = SSOT**: Frontend performs ZERO math. Row totals (row_total), horizon totals (total_revenue, total_cost, total_net) all from backend.
- [x] **Impact Preview**: Shows cash position delta, target month, financial consequence for both carry-forward and write-off. Overperformance handled symmetrically.
- [x] **Matrix Readability**: Stronger visual separation (Revenue/Expense blocks), bolder Total Revenue/Total Cost/Net P/L/Cash Balance rows.
- [x] **Global Variance Tracking**: Summary bar showing total variance, total carried forward, total written off.

### Creed 2 — System Integrity Audit (April 2026)
- [x] **134 tests, 0 failures** — Full scenario-driven audit
- [x] Projection = Matrix = P&L exact match under ALL scenario toggles (committed/likely/extended/full)
- [x] Distributed revenue + linked % COGS: correct per-period amounts, row totals, cross-validation across all 3 views
- [x] Underperformance + carry forward: actual + carryover = planned, all 3 views consistent
- [x] Overperformance + write-off: matrix uses actual, no spurious carryover, all 3 views consistent
- [x] Full undo chain: record actual → carry forward → undo → undo creation → exact baseline restored (revenue, cost, net, flow count all match)
- [x] 24M + 36M horizons: internal consistency verified, 12M is exact subset of 24M
- [x] Multi-entity filtering: each entity internally consistent, sum of entity totals = unfiltered total
- [x] SSOT code review: no .reduce(), no calcRowTotal, backend provides all totals
- [x] Cash balance progression: cash_now + cumulative net = cash_balance per month (verified for all scenarios)
- [x] Rev - Cost = Net consistency: verified for every month under every scenario

## Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + Recharts + @phosphor-icons/react + date-fns
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB (entities, bank_accounts, cash_flows, settings, flow_occurrences, undo_stack)

## Key API Endpoints
- GET /api/projection?scenario=&horizon=&entity_id=
- GET /api/projection/matrix (returns row_total, total_revenue, total_cost, total_net, per-month breakdowns)
- GET /api/month-details/{month}
- GET /api/variance-summary?entity_id=
- POST /api/cash-flows/batch | PUT /api/cash-flows/{id} | DELETE /api/cash-flows/{id}
- PUT /api/flow-occurrences | DELETE /api/flow-occurrences
- POST /api/undo | GET /api/undo/peek

## Prioritized Backlog

### P1
- [ ] CSV import/export for data backup
- [ ] Invoice Import: Upload invoice image → extract fields → draft flow

### P2
- [ ] Historical comparison
- [ ] Custom category management

### P3
- [ ] What-If Simulator (sandboxed)
- [ ] Keyboard shortcuts
- [ ] Mobile optimization
