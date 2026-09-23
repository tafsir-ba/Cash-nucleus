# Evonucleus P&L → Cash Horizon bridge

Pull live P&L metrics from **pl.evonucleus** into Cash Horizon **inflow / outflow**
amount sources. PL remains the SSOT; Cash Horizon links entries to those amounts and
can refresh them.

## What you can source

| Source id (`amount_source_id`) | PL endpoint | Field | Typical quadrant |
|--------------------------------|-------------|-------|------------------|
| `invoiced_open` | `GET /api/ar/summary` | `invoiced_amount_chf` | Confirmed inflow |
| `uninvoiced_open` | `GET /api/ar/summary` | `uninvoiced_amount_chf` | Potential inflow |
| `total_open_ar` | `GET /api/ar/summary` | `total_receivables_chf` | Confirmed / potential inflow |
| `overdue_ar` | `GET /api/ar/summary` | `overdue_receivables_chf` | Confirmed inflow |
| `arr_potential` | `GET /api/maintenance/summary` | `annual_recurring_potential` | Potential inflow |
| `mrr_potential` | `GET /api/maintenance/summary` | `monthly_recurring_potential` | Potential inflow |
| `vendor_remaining` | `GET /api/vendors/aggregation` | sum of `remaining_chf_reporting` (= Vendor **Remaining (to pay)**) | Confirmed / potential outflow |

In the UI: **Cash Horizon → add/edit entry → Amount source → Evonucleus P&L**.

## Configure (cash-nucleus backend)

On the Cash Horizon host `backend/.env` (never commit secrets):

```bash
# PL base URL (no trailing slash). Local example: http://localhost:8000
EVONUCLEUS_API_BASE=https://pnl.example.com

# Same key as PL's OPS_SERVICE_API_KEY (read-only machine credential)
EVONUCLEUS_OPS_API_KEY=<generated-key>
```

On **pl.evonucleus**, ensure `OPS_SERVICE_API_KEY` is set to the same value and that
the paths above stay on the ops allowlist (`docs/ops-service-auth.md` in the PL repo).

Restart cash-nucleus backend after changing env.

## How it works

1. `GET /api/cash-horizon/sources` fetches live metrics via `evonucleus_client` and
   lists them under the **Evonucleus P&L** group.
2. Creating/updating a horizon entry with `amount_source=evonucleus_pl` and a metric
   `amount_source_id` resolves the amount from PL.
3. `POST /api/cash-horizon/refresh-sources` re-pulls all linked Evonucleus amounts
   (same path as Treasury / Bexio refresh).

Auth to PL uses `X-Ops-Api-Key`. No write access to PL is required or used.

## Example: create an inflow linked to Invoiced (Open)

```bash
curl -sS -X POST "$CASH_HOST/api/cash-horizon/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "quadrant": "confirmed_inflow",
    "label": "Invoiced (Open)",
    "timing_mode": "distributed",
    "occurrence_count": 3,
    "amount_source": "evonucleus_pl",
    "amount_source_id": "invoiced_open"
  }'
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Sources show “not configured” | Both `EVONUCLEUS_API_BASE` and `EVONUCLEUS_OPS_API_KEY` set on cash backend |
| 401 from refresh | Key mismatch vs PL `OPS_SERVICE_API_KEY` |
| 403 from refresh | Path not on PL ops allowlist |
| Stale amount | Use **Refresh sources** on Cash Horizon |
