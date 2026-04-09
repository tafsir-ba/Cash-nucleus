# Cash Piloting Dashboard - PRD

## Original Problem Statement
Forward-looking financial decision cockpit. Single user, no auth, CHF currency.
Consolidates bank accounts (state) and cash flows (events) into a deterministic projection engine.

## Core Constraint
**Single projection engine** — all views read from the same computation path. Frontend performs ZERO math.

## Foundation (Verified)
1. Opening balance: persisted, timestamped, not UI state
2. Cash balance purity: opening + cumulative net, no hidden adjustments
3. Time-axis: identical YYYY-MM across all endpoints/horizons
4. Flow identity: UUID, immutable, survives all operations
5. Multi-entity: simple additive consolidation

## What's Been Implemented

### Phase 1-3: Foundation → Control & Realism
- KPI Cards, Scenario Toggle, Horizon (12/24/36M), Chart, Monthly Breakdown
- Quick Add, Entities, Bank Accounts, Linked Flows, Recurrence (Repeat/Distribute)
- Matrix (SSOT), P&L Panel, Actuals & Variance, Undo (full dependency graph)
- Entry Log, Semantic Actuals, Single Scroll Container, Impact Preview

### Trust Lock
- Creed 2 Audit: 134/134 (Projection = Matrix = P&L, all scenarios/horizons)
- Zero frontend math, backend-driven totals

### Decision-Ready Layer (v1 Complete)
- Source Tagging (manual|deal + nullable source_id)
- Flow Priority (critical|flexible|strategic — display only)
- Cash Runway: breach month as primary, months-from-now secondary, committed vs likely
- Top Drivers: aggregated by flow label, total impact + count, top 3 per negative month
- Scenario Gap: cumulative + per-month with time context bars
- Variance Summary: under/over split, carried/written-off, net impact
- Decision Panel: sticky right panel, always visible, order: Runway → Drivers → Gap → Variance

## Architecture
- Frontend: React + Tailwind + Shadcn + Recharts
- Backend: FastAPI + Motor (MongoDB)
- DB: entities, bank_accounts, cash_flows, settings, flow_occurrences, undo_stack

## Prioritized Backlog
- Invoice Import (P1): upload image → extract → draft flow
- CSV import/export (P1)
- Historical comparison (P2)
- What-If Simulator (P3)
- Keyboard shortcuts (P3)
