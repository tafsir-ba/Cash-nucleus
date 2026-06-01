#!/usr/bin/env python3
"""
Pre-deploy verifier: OpenAPI bulk routes + optional live HTTP smoke.

Usage:
  cd backend && python3 scripts/verify_bulk_routes.py
  BASE_URL=https://cash.evonucleus.ch python3 scripts/verify_bulk_routes.py --live
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

REQUIRED_PATHS = {
    "GET": ["/api/actual-imports/matching-flows", "/api/actual-imports", "/api/actual-imports/{batch_id}", "/api/actual-imports/{batch_id}/rows"],
    "POST": [
        "/api/actual-imports/parse",
        "/api/actual-imports/{batch_id}/apply",
        "/api/actual-imports/{batch_id}/rematch",
        "/api/actual-imports/{batch_id}/simulate",
        "/api/actual-imports/{batch_id}/discard",
    ],
    "PUT": ["/api/actual-imports/{batch_id}/rows/{row_id}"],
}


def check_openapi() -> bool:
    os.environ.setdefault("MONGO_URL", "mongodb://localhost")
    os.environ.setdefault("DB_NAME", "verify_openapi")
    os.environ.setdefault("JWT_SECRET", "verify")
    from server import app

    paths = app.openapi()["paths"]
    ok = True
    for method, route_list in REQUIRED_PATHS.items():
        for route in route_list:
            if route not in paths:
                print(f"FAIL missing path: {method} {route}")
                ok = False
            elif method.lower() not in paths[route]:
                print(f"FAIL missing method {method} on {route}")
                ok = False
            else:
                print(f"OK   {method:4} {route}")
    simulate = "/api/actual-imports/{batch_id}/simulate"
    if simulate not in paths:
        print("FAIL simulate route not registered — UI will 404")
        return False
    return ok


def check_live(base: str) -> bool:
    import urllib.request

    url = base.rstrip("/") + "/openapi.json"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception as exc:
        print(f"FAIL could not fetch {url}: {exc}")
        return False
    paths = data.get("paths", {})
    simulate = "/api/actual-imports/{batch_id}/simulate"
    if simulate not in paths or "post" not in paths[simulate]:
        print(f"FAIL live server missing POST {simulate}")
        print("Registered actual-import paths:")
        for p in sorted(k for k in paths if "actual-import" in k):
            print(f"  {p}")
        return False
    print(f"OK   live server exposes POST {simulate}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Also check BASE_URL/openapi.json")
    args = parser.parse_args()
    print("==> OpenAPI (deployed code)")
    if not check_openapi():
        return 1
    if args.live:
        base = os.environ.get("BASE_URL", os.environ.get("REACT_APP_BACKEND_URL", ""))
        if not base:
            print("Set BASE_URL for --live")
            return 1
        print(f"==> Live server {base}")
        if not check_live(base):
            return 1
    print("==> All bulk route checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
