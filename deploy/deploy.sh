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

echo "==> Deploy mode: $MODE"
echo "==> App root: $APP_ROOT"

if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "ERROR: $APP_ROOT is not a git repository."
  exit 1
fi

cd "$APP_ROOT"
echo "==> Pulling latest code"
git pull --ff-only

verify_bulk_actuals_api() {
  echo "==> Verifying bulk actuals simulate API"
  sleep 2
  if [[ ! -f "$BACKEND_DIR/bulk_import_logic.py" ]]; then
    echo "ERROR: missing $BACKEND_DIR/bulk_import_logic.py (git pull incomplete?)"
    exit 1
  fi
  if ! curl -sf "http://127.0.0.1:8001/openapi.json" | grep -q '"/api/actual-imports/{batch_id}/simulate"'; then
    echo "ERROR: Running backend does not expose POST /api/actual-imports/{batch_id}/simulate."
    echo "       Simulate in the UI returns 404 until the backend is redeployed."
    echo "       Run: bash deploy/deploy.sh backend   (not frontend-only)"
    exit 1
  fi
  echo "==> Bulk actuals simulate route OK"
}

deploy_backend() {
  echo "==> Deploying backend"
  cd "$BACKEND_DIR"
  if [[ ! -x "venv/bin/python" ]]; then
    echo "==> Creating backend virtualenv"
    python3 -m venv venv
  fi
  source venv/bin/activate
  pip install -r requirements.prod.txt
  python3 -c "from bulk_import_logic import apply_bulk_import_groups, compute_bulk_import_preview; print('bulk_import_logic import OK')"
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
