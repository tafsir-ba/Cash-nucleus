# Ops service authentication (read-only)

Machine clients (Grok Bot, Chief of Staff) authenticate with a **service API key**
instead of a browser session or a personal password. The key is a dedicated
`service_ops` principal and can only call a small allowlist of GET endpoints.

Human JWT / cookie login is unchanged.

## Configure the key

Add **one** of these to `backend/.env` on the droplet (never commit the value):

```bash
# Preferred: plaintext high-entropy key (compared in constant time)
OPS_SERVICE_API_KEY=<generated-key>

# Optional instead of (or in addition to) plaintext: SHA-256 hex digest of the key
# OPS_SERVICE_API_KEY_SHA256=<hex>
```

Generate a key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Optional hashed form (store the digest in env, keep the raw key only in the bot secret store):

```bash
python3 -c "import hashlib, secrets; k=secrets.token_urlsafe(48); print('key', k); print('sha256', hashlib.sha256(k.encode()).hexdigest())"
```

Restart the backend after changing env (`supervisorctl restart cashpilot-backend`).
The process already loads `backend/.env` via `python-dotenv`; nginx stays bound to
localhost uvicorn + domain TLS. Do not expose uvicorn publicly.

Rotate by generating a new key, updating `.env` (and every bot that uses it), then
restarting. Remove the old value so it no longer verifies.

If neither env var is set, service-key auth is disabled. A request that still
sends `X-Ops-Api-Key` is rejected with 401.

## How to send the key

Either header works. Prefer `X-Ops-Api-Key` so it cannot collide with a human JWT
`Authorization: Bearer` token.

```http
X-Ops-Api-Key: <key>
```

```http
Authorization: Bearer <key>
```

## Allowlisted GET endpoints

Only **GET** on these paths is permitted:

| Path | Purpose |
| --- | --- |
| `/api/` | API health |
| `/api/auth/me` | Confirms the service principal (`role=service_ops`) |
| `/api/entities` | Entities |
| `/api/bank-accounts` | Cash balances |
| `/api/treasury/cash-position-history` | Balance history |
| `/api/treasury/debts` | Debt consolidation |
| `/api/cash-horizon` | Horizon / pressure summary |
| `/api/cash-flows` | Flows |
| `/api/cash-flows/with-linked` | Flows with parent/child grouping |
| `/api/flow-occurrences` | Actuals overlay |
| `/api/flow-occurrences/{flow_id}/history` | Occurrence audit trail |
| `/api/settings` | Safety buffer / settings |
| `/api/meta/cash-flow` | Categories / meta |
| `/api/projection` | Projection months + KPIs |
| `/api/projection/matrix` | Matrix (same engine) |
| `/api/projection/drivers` | Negative-month drivers |
| `/api/projection/scenario-delta` | Committed vs likely gap |
| `/api/projection/runway` | Cash runway |
| `/api/month-details/{month}` | Month breakdown (`YYYY-MM`) |
| `/api/variance-summary` | Variance totals |

Anything else with this key returns **403** (`Service API key is read-only`),
including POST/PUT/PATCH/DELETE (entities, flows, imports, password-related
routes, undo, settings writes) and GETs that are not on the list (bulk actual
imports, undo peek).

Invalid `X-Ops-Api-Key` → **401**. Missing credentials on `/api/auth/me` → **401**.

Service-key use is logged (`ops-service-auth: allow|deny …`) without the key value.

## Example curl

Replace the host and key. Quotes matter; do not put the key in a repo or ticket.

```bash
export OPS_SERVICE_API_KEY='…'   # from the secret store, not from git
export BASE='https://cash.evonucleus.ch'

# Who am I
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/auth/me"

# Runway + KPIs
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/projection/runway"
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/projection?scenario=likely&horizon=12"

# Entities, balances, horizon
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/entities"
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/bank-accounts"
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/cash-horizon"
curl -sS -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" "$BASE/api/variance-summary"

# Bearer form (same key)
curl -sS -H "Authorization: Bearer $OPS_SERVICE_API_KEY" "$BASE/api/projection/runway"
```

A mutation must fail:

```bash
curl -sS -o /tmp/ops-deny.json -w "%{http_code}\n" \
  -H "X-Ops-Api-Key: $OPS_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"should-not-create"}' \
  "$BASE/api/entities"
# expected: 403
```

## Tests

From `backend/`:

```bash
python3 -m pytest tests/test_ops_service_auth.py -v
```

Requires `pytest` and `mongomock-motor` (`requirements.test.txt`).
