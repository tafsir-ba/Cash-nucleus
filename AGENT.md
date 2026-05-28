# AGENT.md

## Production Incident Learnings (2026-05-28)

### Summary of what went wrong
- Domain `/api` upstream was pointed to the wrong backend service/port (`deal-engine` on 8002), which made app data appear missing.
- Correct backend process (`cashpilot-backend`) was not running on expected port 8001.
- Supervisor command used system Python (`/usr/bin/python3`) instead of project venv, causing missing-module crashes (`uvicorn`, `bcrypt`, `jwt`).
- Backend startup failed due to Mongo index option conflict (`cash_balance_snapshots` key existed with different options).
- Login errors were initially misleading because infra and routing failures surfaced as generic auth failures.

## Mandatory triage order (before code changes)
1. **Process health**
   - `supervisorctl status`
   - `ss -ltnp | grep -E '8001|8002|uvicorn|python'`
2. **Local backend health**
   - `curl -i http://127.0.0.1:<backend-port>/api/`
3. **Nginx upstream mapping**
   - Inspect `/etc/nginx/sites-enabled/*` for `/api` `proxy_pass` target.
   - Ensure domain points to the intended backend/port.
4. **Domain API verification**
   - `curl -i https://<domain>/api/`
   - `curl -i -X POST https://<domain>/api/auth/login ...`
5. **Only then** investigate app code.

## Multi-service host guardrails
- Never switch nginx upstream ports without confirming service ownership of that port.
- On hosts with multiple apps, wrong upstream can mimic “data loss” by connecting to a different DB/app context.
- Treat “missing data” after routing changes as a **wrong backend context** hypothesis first.

## Supervisor standards
- Always run backend with project venv interpreter, not system Python.
- Preferred command:
  - `/opt/<app>/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port <port> --log-level info`
- Ensure `directory=/opt/<app>/backend` and dedicated logs under `/var/log/<app>/`.

## Dependency installation policy
- For server runtime, install from `requirements.prod.txt`.
- Avoid `requirements.txt` in production if it contains non-runtime or unavailable packages.
- If on Debian/Ubuntu with externally-managed Python, use project `venv` (no system `pip` unless explicitly intended).

## Mongo index migration safety
- Index changes must be idempotent with existing production indexes.
- If changing options on existing key pattern (e.g. adding `partialFilterExpression`), include migration logic:
  - detect conflicting existing index
  - drop/recreate safely
  - log actions clearly
- Startup should not hard-fail on known, recoverable index conflicts without actionable logs.

## Auth debugging playbook
- Distinguish failures:
  - `401 Invalid email or password` → credential issue
  - `502` / connection refused → process/upstream issue
  - Generic frontend “Login failed” → often CORS/network/upstream before auth logic
- Confirm cookie behavior only after API reachability is verified.

## Operational recovery checklist
1. Restore correct nginx `/api` upstream.
2. Ensure intended backend process exists and is running.
3. Verify backend local health endpoint.
4. Verify domain health endpoint.
5. Verify login API.
6. Verify business data visibility in UI.
