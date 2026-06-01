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
git pull --ff-only
echo "==> Git HEAD: $(git rev-parse --short HEAD) on $(git branch --show-current)"

verify_bulk_actuals_api() {
  echo "==> Verifying bulk actuals simulate API"
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

  echo "==> Checking deployed Python exposes simulate route"
  (
    cd "$BACKEND_DIR"
    MONGO_URL="${MONGO_URL:-mongodb://127.0.0.1:27017}" \
    DB_NAME="${DB_NAME:-cashpilot}" \
    JWT_SECRET="${JWT_SECRET:-deploy-check}" \
    "$py" -c "from server import app; p='/api/actual-imports/{batch_id}/simulate'; assert p in app.openapi()['paths'], p"
  ) || {
    echo "ERROR: Checked-out backend code does not register simulate route."
    exit 1
  }

  if [[ -f "$SUPERVISOR_CONF" ]]; then
    echo "==> Supervisor command (must use $BACKEND_DIR/venv/bin/uvicorn):"
    grep -E '^command=' "$SUPERVISOR_CONF" || true
    if ! grep -q "$BACKEND_DIR/venv/bin/uvicorn" "$SUPERVISOR_CONF" 2>/dev/null; then
      echo "WARNING: Supervisor may not be running the project venv from $BACKEND_DIR"
    fi
  fi

  local attempt
  for attempt in 1 2 3 4 5 6; do
    sleep 2
    if curl -sf "http://127.0.0.1:8001/openapi.json" | grep -q '"/api/actual-imports/{batch_id}/simulate"'; then
      echo "==> Bulk actuals simulate route OK (running server)"
      return 0
    fi
    echo "==> Waiting for API on :8001 (attempt $attempt/6)..."
  done

  echo "ERROR: Running backend on :8001 does not expose POST /api/actual-imports/{batch_id}/simulate."
  echo "       Deployed code is correct but the live process is stale or wrong."
  echo "       Fix supervisor to use: $BACKEND_DIR/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001"
  echo "       directory=$BACKEND_DIR"
  echo "       Then: supervisorctl reread && supervisorctl update && supervisorctl restart $SUPERVISOR_PROCESS"
  echo "       Routes under actual-imports in live OpenAPI:"
  curl -sf "http://127.0.0.1:8001/openapi.json" 2>/dev/null | grep -o '"/api/actual-imports[^"]*"' | sort -u || echo "       (could not fetch openapi.json)"
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
  supervisorctl restart "$SUPERVISOR_PROCESS"
  supervisorctl status "$SUPERVISOR_PROCESS"
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
