#!/usr/bin/env bash
set -euo pipefail

# CashPilot production deploy script
# Usage:
#   bash deploy/deploy.sh            # full deploy (backend + frontend)
#   bash deploy/deploy.sh backend    # backend only
#   bash deploy/deploy.sh frontend   # frontend only

MODE="${1:-full}"
APP_ROOT="/opt/cashpilot"
BACKEND_DIR="$APP_ROOT/backend"
FRONTEND_DIR="$APP_ROOT/frontend"
SUPERVISOR_PROCESS="cashpilot-backend"
SUPERVISOR_CONF="/etc/supervisor/conf.d/cashpilot.conf"

echo "==> Deploy mode: $MODE"
echo "==> App root: $APP_ROOT"

if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "ERROR: $APP_ROOT is not a git repository."
  exit 1
fi

cd "$APP_ROOT"
echo "==> Pulling latest code"
git fetch origin main
git checkout main
git pull --ff-only origin main
echo "==> Git HEAD: $(git rev-parse --short HEAD) on $(git branch --show-current)"

REQUIRED_OPENAPI_PATHS=(
  '"/api/actual-imports/matching-flows"'
  '"/api/actual-imports/{batch_id}/simulate"'
  '"/api/actual-imports/{batch_id}/rematch"'
)

ensure_supervisor_config() {
  echo "==> Writing supervisor config (directory=$BACKEND_DIR)"
  mkdir -p /var/log/cashpilot
  cat > "$SUPERVISOR_CONF" <<EOF
[program:cashpilot-backend]
command=${BACKEND_DIR}/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --log-level info
directory=${BACKEND_DIR}
user=root
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
stderr_logfile=/var/log/cashpilot/backend.err.log
stdout_logfile=/var/log/cashpilot/backend.out.log
environment=PATH="${BACKEND_DIR}/venv/bin"
EOF
  supervisorctl reread
  supervisorctl update
}

restart_backend_supervised() {
  ensure_supervisor_config
  echo "==> Stopping backend and clearing stale listeners on :8001"
  supervisorctl stop "$SUPERVISOR_PROCESS" 2>/dev/null || true
  sleep 2
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 8001/tcp 2>/dev/null || true
    sleep 1
  fi
  supervisorctl start "$SUPERVISOR_PROCESS"
  supervisorctl status "$SUPERVISOR_PROCESS"
}

verify_bulk_actuals_api() {
  echo "==> Verifying bulk actuals API on live server"
  local py="$BACKEND_DIR/venv/bin/python"

  for f in bulk_import_logic.py bulk_flow_match.py; do
    if [[ ! -f "$BACKEND_DIR/$f" ]]; then
      echo "ERROR: missing $BACKEND_DIR/$f (git pull incomplete?)"
      exit 1
    fi
  done

  if [[ ! -x "$py" ]]; then
    echo "ERROR: $py not found"
    exit 1
  fi

  echo "==> Checking checked-out code registers bulk routes"
  (
    cd "$BACKEND_DIR"
    MONGO_URL="${MONGO_URL:-mongodb://127.0.0.1:27017}" \
    DB_NAME="${DB_NAME:-cashpilot}" \
    JWT_SECRET="${JWT_SECRET:-deploy-check}" \
    "$py" -c "
from server import app
paths = app.openapi()['paths']
required = [
    '/api/actual-imports/matching-flows',
    '/api/actual-imports/{batch_id}/simulate',
    '/api/actual-imports/{batch_id}/rematch',
]
missing = [p for p in required if p not in paths]
if missing:
    raise SystemExit('missing routes in code: ' + ', '.join(missing))
print('code routes OK:', ', '.join(required))
"
  ) || {
    echo "ERROR: Checked-out backend code does not register required bulk routes."
    exit 1
  }

  local attempt openapi
  for attempt in 1 2 3 4 5 6 8 10; do
    sleep 2
    if ! openapi="$(curl -sf "http://127.0.0.1:8001/openapi.json" 2>/dev/null)"; then
      echo "==> Waiting for API on :8001 (attempt $attempt)..."
      continue
    fi
    local missing_live=()
    for needle in "${REQUIRED_OPENAPI_PATHS[@]}"; do
      if ! grep -qF "$needle" <<<"$openapi"; then
        missing_live+=("$needle")
      fi
    done
    if [[ ${#missing_live[@]} -eq 0 ]]; then
      echo "==> Live server bulk routes OK"
      return 0
    fi
    echo "==> Live server missing routes (attempt $attempt): ${missing_live[*]}"
  done

  echo "ERROR: Live backend on :8001 is not running code from $BACKEND_DIR"
  echo "       Supervisor command should be:"
  echo "       ${BACKEND_DIR}/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001"
  echo "       directory=${BACKEND_DIR}"
  echo "       Registered actual-import paths on live server:"
  curl -sf "http://127.0.0.1:8001/openapi.json" 2>/dev/null | grep -o '"/api/actual-imports[^"]*"' | sort -u || true
  echo "       Process on :8001:"
  ss -ltnp 2>/dev/null | grep 8001 || true
  exit 1
}

run_backend_tests() {
  echo "==> Running bulk route smoke tests (in-memory DB)"
  cd "$BACKEND_DIR"
  source venv/bin/activate
  pip install -q -r requirements.test.txt 2>/dev/null || pip install -q pytest mongomock-motor
  python3 scripts/verify_bulk_routes.py || exit 1
  python3 -m pytest tests/test_bulk_actual_routes_smoke.py tests/test_bulk_flow_match_unit.py -q --tb=line || {
    echo "ERROR: Pre-deploy route tests failed"
    exit 1
  }
  deactivate
}

deploy_backend() {
  run_backend_tests
  echo "==> Deploying backend"
  cd "$BACKEND_DIR"
  if [[ ! -x "venv/bin/python" ]]; then
    echo "==> Creating backend virtualenv"
    python3 -m venv venv
  fi
  source venv/bin/activate
  pip install -r requirements.prod.txt
  python3 -c "from bulk_import_logic import apply_bulk_import_groups, compute_bulk_import_preview; print('bulk_import_logic import OK')"
  python3 -c "from bulk_flow_match import best_flow_match; print('bulk_flow_match import OK')"
  deactivate
  restart_backend_supervised
  verify_bulk_actuals_api
}

deploy_frontend() {
  echo "==> Deploying frontend"
  cd "$FRONTEND_DIR"
  yarn install --frozen-lockfile
  yarn build
  systemctl reload nginx
}

case "$MODE" in
  full)
    deploy_backend
    deploy_frontend
    ;;
  backend)
    deploy_backend
    ;;
  frontend)
    echo "WARNING: frontend-only deploy does not restart the API. Simulate needs: bash deploy/deploy.sh backend"
    deploy_frontend
    ;;
  *)
    echo "ERROR: invalid mode '$MODE'. Use: full | backend | frontend"
    exit 1
    ;;
esac

echo "==> Deploy completed successfully"
