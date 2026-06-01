#!/usr/bin/env bash
# One-shot repair when deploy fails: live API missing simulate/rematch routes.
# Run on the server as root: bash deploy/fix-supervisor.sh
set -euo pipefail
APP_ROOT="/opt/cashpilot"
exec bash "$APP_ROOT/deploy/deploy.sh" backend
