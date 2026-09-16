"""Read-only machine/service authentication for ops bots.

A high-entropy key is configured in the server environment (never in git).
Machine clients send it as ``X-Ops-Api-Key`` or ``Authorization: Bearer <key>``.
The key maps to a dedicated ``service_ops`` principal that may only call a
small allowlist of GET endpoints used by cash-runway / KPI digests.

Human JWT/cookie login is unchanged. Presenting an invalid service key is
always 401 (including on routes that are otherwise unauthenticated). A valid
key on any non-allowlisted route is 403.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
from typing import Optional, Tuple

from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger("ops_service_auth")

OPS_SERVICE_API_KEY_ENV = "OPS_SERVICE_API_KEY"
OPS_SERVICE_API_KEY_SHA256_ENV = "OPS_SERVICE_API_KEY_SHA256"
OPS_SERVICE_HEADER = "X-Ops-Api-Key"

OPS_SERVICE_PRINCIPAL = {
    "id": "ops-service",
    "email": "ops-service@local",
    "name": "Ops Service",
    "role": "service_ops",
    "read_only": True,
}

# Dashboard / digest GETs. Import-admin, undo, and every mutating route stay out.
_OPS_EXACT_GET_PATHS = frozenset(
    {
        "/api",
        "/api/",
        "/api/auth/me",
        "/api/entities",
        "/api/bank-accounts",
        "/api/treasury/cash-position-history",
        "/api/treasury/debts",
        "/api/cash-horizon",
        "/api/cash-flows",
        "/api/cash-flows/with-linked",
        "/api/flow-occurrences",
        "/api/settings",
        "/api/meta/cash-flow",
        "/api/projection",
        "/api/projection/matrix",
        "/api/projection/drivers",
        "/api/projection/scenario-delta",
        "/api/projection/runway",
        "/api/variance-summary",
    }
)

_OPS_PARAM_GET_PATHS = (
    re.compile(r"^/api/month-details/[^/]+$"),
    re.compile(r"^/api/flow-occurrences/[^/]+/history$"),
)


def is_ops_allowlisted_path(path: str) -> bool:
    """Return True if ``path`` is a GET the service key may call."""
    if path in _OPS_EXACT_GET_PATHS:
        return True
    return any(pattern.match(path) for pattern in _OPS_PARAM_GET_PATHS)


def _configured_plain_key() -> str:
    return os.environ.get(OPS_SERVICE_API_KEY_ENV, "").strip()


def _configured_sha256() -> str:
    return os.environ.get(OPS_SERVICE_API_KEY_SHA256_ENV, "").strip().lower()


def ops_service_auth_enabled() -> bool:
    return bool(_configured_plain_key() or _configured_sha256())


def verify_ops_service_key(presented: str) -> bool:
    """Constant-time compare against the env key and/or its SHA-256 hex digest."""
    if not presented:
        return False
    presented = presented.strip()
    if not presented:
        return False

    plain = _configured_plain_key()
    if plain and hmac.compare_digest(presented.encode("utf-8"), plain.encode("utf-8")):
        return True

    digest = _configured_sha256()
    if digest:
        got = hashlib.sha256(presented.encode("utf-8")).hexdigest()
        if hmac.compare_digest(got, digest):
            return True
    return False


def extract_ops_credential(request: Request) -> Tuple[Optional[str], str]:
    """Return ``(credential, source)`` where source is ``header``, ``bearer``, or ``""``.

    ``X-Ops-Api-Key`` wins when both are present so a bot cannot accidentally
    mix a JWT Bearer token with a service-key header.
    """
    header = (request.headers.get(OPS_SERVICE_HEADER) or "").strip()
    if header:
        return header, "header"
    auth = request.headers.get("Authorization") or request.headers.get("authorization") or ""
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        if token:
            return token, "bearer"
    return None, ""


def _deny(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail})


def authorize_ops_service_request(request: Request) -> Optional[JSONResponse]:
    """Gate machine credentials. Return a response to short-circuit, or None.

    - Invalid ``X-Ops-Api-Key`` → 401 (never fall through).
    - Bearer token that matches the service key → treated as the service principal.
    - Bearer token that does not match → left for JWT/cookie auth.
    - Valid service principal on a non-allowlisted route → 403.
    """
    if request.method == "OPTIONS":
        return None

    cred, source = extract_ops_credential(request)
    is_service = False
    if source == "header":
        if not verify_ops_service_key(cred or ""):
            logger.warning(
                "ops-service-auth: invalid X-Ops-Api-Key method=%s path=%s",
                request.method,
                request.url.path,
            )
            return _deny(401, "Invalid service API key")
        is_service = True
    elif source == "bearer" and verify_ops_service_key(cred or ""):
        is_service = True

    if not is_service:
        return None

    request.state.ops_service_principal = OPS_SERVICE_PRINCIPAL
    path = request.url.path
    if request.method != "GET" or not is_ops_allowlisted_path(path):
        logger.warning(
            "ops-service-auth: deny method=%s path=%s (read-only allowlist)",
            request.method,
            path,
        )
        return _deny(403, "Service API key is read-only")

    logger.info("ops-service-auth: allow GET %s", path)
    return None
