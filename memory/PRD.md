# Cash Piloting Dashboard - PRD

## Original Problem Statement
Forward-looking financial decision cockpit. Single user, no auth, CHF currency.
Consolidates bank accounts (state) and cash flows (events) into a deterministic projection engine.

## Core Constraint
**Single projection engine** — all views (chart, monthly breakdown, matrix table, P&L panel, decision panel) read from the same computation path. No duplicate computation layers. Frontend performs ZERO mathematical operations on projection data.

## Foundation (Verified)
1. **Opening balance**: cash_now = sum(bank_accounts.amount), persisted in MongoDB, timestamped
2. **Cash balance purity**: cash_balance(month_n) = opening_balance + cumulative_net_flows — no hidden adjustments
3. **Time-axis consistency**: all endpoints use identical YYYY-MM keys across 12/24/36M horizons
4. **Flow identity**: UUID-based, immutable, survives edits/undo/variance, ready for deal-linked traceability
5. **Multi-entity consolidation**: simple additive, each flow belongs to exactly one entity

## What's Been Implemented

### Phase 1 — Foundation
- [x] KPI Cards, Scenario Toggle, Flexible Horizon, Projection Chart, Monthly Breakdown
- [x] Quick Add, Entity Management, Bank Accounts, Linked Flows, Recurrence, Dark theme

### Phase 2 — Operational Realism
- [x] Recurrence Mode: Repeat vs Distribute, Cash Flow Table (matrix), P&L Panel

### Phase 3 — Control & Realism
- [x] Matrix reads from projection engine, Actuals & Variance system, Undo System
- [x] Full-page Entry Log, Matrix UX, Semantic Actuals, Single Scroll Container

### Final Control & Trust Lock
- [x] Undo Full Dependency Graph, Matrix = SSOT, Impact Preview, Matrix Readability
- [x] Global Variance Tracking, Creed 2 System Audit (134/134)

### Decision-Ready Layer (April 2026)
- [x] **Source Tagging**: source_type (manual|deal), source_id (nullable) — pure metadata, future-proof for deal integration
- [x] **Flow Priority**: critical|flexible|strategic — store + display only, no simulation impact
- [x] **Top Drivers**: Per negative month, top 3 negative contributors aggregated by flow label with occurrence count
- [x] **Scenario Delta**: Gap = likely_balance - committed_balance per month, total gap, sparkline visualization
- [x] **Cash Runway**: First month where balance < 0, committed vs likely, months + breach month
- [x] **Enhanced Variance Summary**: under/over-performance split, net variance impact, carried/written-off totals

## Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + Recharts + @phosphor-icons/react + date-fns
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB (entities, bank_accounts, cash_flows, settings, flow_occurrences, undo_stack)

## Key API Endpoints
- GET /api/projection, GET /api/projection/matrix
- GET /api/projection/drivers, GET /api/projection/scenario-delta, GET /api/projection/runway
- GET /api/month-details/{month}, GET /api/variance-summary
- POST /api/cash-flows/batch | PUT /api/cash-flows/{id} | DELETE /api/cash-flows/{id}
- PUT /api/flow-occurrences | DELETE /api/flow-occurrences
- POST /api/undo | GET /api/undo/peek

## Prioritized Backlog

### P1
- [ ] Invoice Import: Upload invoice image → extract fields → draft flow (editable, uses canonical editor)
- [ ] CSV import/export for data backup

### P2
- [ ] Historical comparison
- [ ] Custom category management

### P3
- [ ] What-If Simulator (sandboxed)
- [ ] Keyboard shortcuts
- [ ] Mobile optimization

## Testing Status
- Iteration 10: Backend 25/25 (100%) + Creed 2 134/134 + Frontend 100%
- All features verified: source tagging, priority, drivers, delta, runway, variance
- Zero drift confirmed after all changes
