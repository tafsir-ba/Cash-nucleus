"""Unit tests for the in-process login limiter. No server, no secrets."""
from __future__ import annotations

from login_rate_limit import LoginRateLimiter


def test_email_bucket_blocks_other_ips():
    limiter = LoginRateLimiter(max_attempts=2, window_seconds=100)
    assert limiter.allow(ip="10.0.0.1", email="A@Example.com", now=0) is True
    assert limiter.allow(ip="10.0.0.1", email="a@example.com", now=1) is True
    assert limiter.allow(ip="10.0.0.2", email="a@example.com", now=2) is False


def test_ip_bucket_blocks_other_emails():
    limiter = LoginRateLimiter(max_attempts=2, window_seconds=100)
    assert limiter.allow(ip="10.0.0.9", email="one@example.com", now=0) is True
    assert limiter.allow(ip="10.0.0.9", email="two@example.com", now=1) is True
    assert limiter.allow(ip="10.0.0.9", email="three@example.com", now=2) is False


def test_window_expiry_allows_again():
    limiter = LoginRateLimiter(max_attempts=1, window_seconds=10)
    assert limiter.allow(ip="10.1.1.1", email="a@example.com", now=0) is True
    assert limiter.allow(ip="10.1.1.1", email="a@example.com", now=5) is False
    assert limiter.allow(ip="10.1.1.1", email="a@example.com", now=16) is True


def test_missing_ip_shares_one_bucket():
    limiter = LoginRateLimiter(max_attempts=1, window_seconds=100)
    assert limiter.allow(ip="", email="a@example.com", now=0) is True
    assert limiter.allow(ip="", email="b@example.com", now=1) is False
