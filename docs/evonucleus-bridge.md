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
| `vendor_remaining` | `GET /api/vendors/aggregation` | signed sum of `remaining_chf_reporting` (fallback `remaining_chf`) — same as the Vendor tab **Remaining (to pay)** KPI | Confirmed / potential outflow |

In the UI: **Cash Horizon → add/edit entry → Amount source → Evonucleus P&L**.

## Configure (cash-nucleus backend)

On the Cash Horizon host `backend/.env` (never commit secrets):

```bash
# Same key as PL's OPS_SERVICE_API_KEY (read-only machine credential)
EVONUCLEUS_OPS_API_KEY=<generated-key>

# Optional. Defaults to https://pl.evonucleus.ch
# EVONUCLEUS_API_BASE=https://pl.evonucleus.ch
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

Cash Horizon reads and the refresh that calls PL require a logged-in Cash session
(the same cookie/`Authorization` check as the rest of the money routes). The ops
service key stays read-only and is not granted the P&L source catalog.

### Remaining (to pay)

`GET /api/vendors/aggregation` returns one row per vendor. It does not include a
portfolio total. The P&L Vendor tab defines **Remaining (to pay)** as the sum of
each row's `remaining_chf_reporting` (fallback `remaining_chf`). That sum is
signed: a credit reduces what is owed. Cash uses that sum as-is and does not
take `abs` or recompute cost minus paid. A separate P&L field is unnecessary
while this row contract is the definition the Vendor tab already uses.

Upstream P&L failures are logged with a short code (`evonucleus_unavailable`,
`evonucleus_not_configured`, `evonucleus_unknown_metric`). Horizon rows store
that code. The UI shows a generic message, not the upstream body.

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
| 401 on sources, horizon, bank accounts, or refresh | Cash session cookie (or Bearer access token) is missing. These routes require login. |
| Sources show “not configured” / row code `evonucleus_not_configured` | `EVONUCLEUS_OPS_API_KEY` set on the cash backend (same value as PL `OPS_SERVICE_API_KEY`) |
| Row code `evonucleus_unavailable` | PL rejected or failed the ops call. Cash logs the upstream status; the UI does not show the body. Check the key and the PL ops allowlist. |
| Stale amount | Use **Refresh linked** on Cash Horizon while logged in. |
