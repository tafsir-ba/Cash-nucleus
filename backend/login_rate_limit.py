"""In-process login attempt limiter.

Counts password-check attempts by client IP and by email. When either bucket
is full, the attempt is rejected with HTTP 429 and is still recorded so the
window does not reset. There is no second auth system here; this only gates
POST /api/auth/login before the password is checked.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Dict, List, Optional

from starlette.requests import Request

_DEFAULT_MAX_ATTEMPTS = 10
_DEFAULT_WINDOW_SECONDS = 900.0


def _positive_int(raw: Optional[str], default: int) -> int:
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _positive_float(raw: Optional[str], default: float) -> float:
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def client_ip(request: Request) -> str:
    """Peer address, or nginx X-Real-IP when the peer is the local proxy.

    A missing address shares one bucket so callers cannot skip the limit.
    """
    peer = ""
    if request.client and request.client.host:
        peer = request.client.host.strip()
    real = (request.headers.get("x-real-ip") or "").strip()
    if real and peer in {"127.0.0.1", "::1"}:
        return real
    return peer or "unknown"


class LoginRateLimiter:
    def __init__(
        self,
        max_attempts: Optional[int] = None,
        window_seconds: Optional[float] = None,
    ):
        if max_attempts is None:
            max_attempts = _positive_int(os.environ.get("LOGIN_RATE_LIMIT_MAX"), _DEFAULT_MAX_ATTEMPTS)
        if window_seconds is None:
            window_seconds = _positive_float(
                os.environ.get("LOGIN_RATE_LIMIT_WINDOW_SECONDS"),
                _DEFAULT_WINDOW_SECONDS,
            )
        self.max_attempts = max(1, int(max_attempts))
        self.window_seconds = float(window_seconds) if window_seconds and window_seconds > 0 else _DEFAULT_WINDOW_SECONDS
        self._hits: Dict[str, List[float]] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def retry_after_seconds(self) -> int:
        return max(1, int(self.window_seconds))

    def allow(self, *, ip: str, email: str, now: Optional[float] = None) -> bool:
        """Return False when this IP or email is already over the limit.

        The attempt is recorded either way. Over-limit calls stay denied
        until the earlier attempts age out of the window.
        """
        moment = time.monotonic() if now is None else float(now)
        ip_key = f"ip:{(ip or '').strip() or 'unknown'}"
        email_key = f"email:{(email or '').strip().lower()}"
        with self._lock:
            for key in (ip_key, email_key):
                cutoff = moment - self.window_seconds
                self._hits[key] = [stamp for stamp in self._hits.get(key, []) if stamp > cutoff]
            blocked = any(len(self._hits[key]) >= self.max_attempts for key in (ip_key, email_key))
            for key in (ip_key, email_key):
                self._hits[key].append(moment)
            return not blocked


login_rate_limiter = LoginRateLimiter()
