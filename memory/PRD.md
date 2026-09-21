# Cash Pilot — Product Scope

## Active modules (v2 strip)

1. **Treasury**
   - Bank account list (standard + factoring/receivables)
   - Debt consolidation (create / edit / delete)
   - **Cash balance evolution chart** (cash position history from bank snapshots)
   - Entities (needed to assign accounts/debts)

2. **Cash Horizon**
   - Quadrant entries, checkpoints, liquidity/match charts
   - Kept as-is for now; rework planned as a follow-up

## Removed from the product UI

- Projection tab (chart / monthly table / KPI / decision / P&L / scenarios / horizon)
- Cash Flow Table (matrix)
- Entries / Entry Log
- Bulk Actuals
- Quick Add, Settings (safety buffer), projection-driven undo chrome

## Notes

- Debt rows are still stored as cash flows with `category: Debt` under the hood.
  The treasury module is the only UI that creates/edits them.
- Legacy projection / bulk / matrix API routes may still exist on the backend for
  data continuity; they are not exposed in the app shell.
