"""Ops service API key: allowlisted GET, deny mutations, 401 on bad/missing key.

Run: cd backend && pytest tests/test_ops_service_auth.py -v
"""
from __future__ import annotations

import hashlib
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

TEST_SERVICE_KEY = "test-ops-service-key-not-a-real-secret"

os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", f"ops_auth_test_{uuid.uuid4().hex[:8]}")
os.environ.setdefault("JWT_SECRET", "ops-auth-test-secret")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin123")
os.environ["OPS_SERVICE_API_KEY"] = TEST_SERVICE_KEY
os.environ["COOKIE_SECURE"] = "false"
os.environ["ENV"] = "test"

import server  # noqa: E402
from ops_service_auth import (  # noqa: E402
    is_ops_allowlisted_path,
    verify_ops_service_key,
)

server.client = AsyncMongoMockClient()
server.db = server.client[os.environ["DB_NAME"]]

SERVICE_HEADERS = {"X-Ops-Api-Key": TEST_SERVICE_KEY}
BEARER_HEADERS = {"Authorization": f"Bearer {TEST_SERVICE_KEY}"}

ALLOWLISTED_GETS = [
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
    "/api/month-details/2026-09",
    "/api/flow-occurrences/any-id/history",
]


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app) as c:
        yield c


def test_allowlist_paths():
    for path in ALLOWLISTED_GETS:
        assert is_ops_allowlisted_path(path), path
    assert is_ops_allowlisted_path("/api/flow-occurrences/flow-1/history")
    assert not is_ops_allowlisted_path("/api/actual-imports")
    assert not is_ops_allowlisted_path("/api/undo/peek")
    assert not is_ops_allowlisted_path("/api/entities/some-id")
    assert not is_ops_allowlisted_path("/api/cash-flows/batch")


def test_verify_key_constant_time_match():
    assert verify_ops_service_key(TEST_SERVICE_KEY) is True
    assert verify_ops_service_key("wrong-key") is False
    assert verify_ops_service_key("") is False


def test_valid_header_key_reads_allowlisted_gets(client: TestClient):
    for path in ALLOWLISTED_GETS:
        resp = client.get(path, headers=SERVICE_HEADERS)
        assert resp.status_code == 200, f"{path}: {resp.status_code} {resp.text}"


def test_valid_bearer_key_reads_runway_and_me(client: TestClient):
    me = client.get("/api/auth/me", headers=BEARER_HEADERS)
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["role"] == "service_ops"
    assert body["read_only"] is True
    assert body["id"] == "ops-service"

    runway = client.get("/api/projection/runway", headers=BEARER_HEADERS)
    assert runway.status_code == 200, runway.text
    assert "committed" in runway.json() or "likely" in runway.json() or isinstance(runway.json(), dict)


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("post", "/api/entities", {"json": {"name": "ShouldNotCreate"}}),
        ("put", "/api/settings", {"json": {"safety_buffer": 1}}),
        ("post", "/api/cash-flows", {"json": {"label": "x", "amount": 1, "date": "2026-09-01", "category": "Expense", "certainty": "Sure to happen", "recurrence": "none", "entity_id": "nope"}}),
        ("post", "/api/undo", {}),
        ("post", "/api/auth/login", {"json": {"email": "admin@example.com", "password": "admin123"}}),
        ("delete", "/api/entities/does-not-matter", {}),
        ("post", "/api/actual-imports/parse", {}),
        ("put", "/api/flow-occurrences", {"json": {"flow_id": "x", "month": "2026-09", "actual_amount": 1}}),
    ],
)
def test_valid_key_cannot_mutate(client: TestClient, method: str, path: str, kwargs: dict):
    resp = getattr(client, method)(path, headers=SERVICE_HEADERS, **kwargs)
    assert resp.status_code == 403, f"{method.upper()} {path}: {resp.status_code} {resp.text}"
    assert "read-only" in resp.json()["detail"].lower()


def test_valid_key_cannot_read_non_allowlisted_get(client: TestClient):
    resp = client.get("/api/actual-imports", headers=SERVICE_HEADERS)
    assert resp.status_code == 403, resp.text


def test_missing_key_auth_me_401():
    with TestClient(server.app) as anon:
        resp = anon.get("/api/auth/me")
        assert resp.status_code == 401, resp.text


def test_invalid_header_key_401(client: TestClient):
    resp = client.get("/api/entities", headers={"X-Ops-Api-Key": "definitely-wrong"})
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"] == "Invalid service API key"


def test_invalid_bearer_on_protected_route_401(client: TestClient):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-the-service-key"})
    assert resp.status_code == 401, resp.text


def test_human_jwt_cookie_still_works():
    with TestClient(server.app) as human:
        login = human.post(
            "/api/auth/login",
            json={"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert login.status_code == 200, login.text
        me = human.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["email"] == os.environ["ADMIN_EMAIL"]
        assert me.json().get("role") != "service_ops"


def test_sha256_configured_key(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    secret = "sha256-only-ops-key-not-real"
    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    monkeypatch.delenv("OPS_SERVICE_API_KEY", raising=False)
    monkeypatch.setenv("OPS_SERVICE_API_KEY_SHA256", digest)

    assert verify_ops_service_key(secret) is True
    assert verify_ops_service_key(TEST_SERVICE_KEY) is False

    resp = client.get("/api/projection/runway", headers={"X-Ops-Api-Key": secret})
    assert resp.status_code == 200, resp.text

    denied = client.get("/api/projection/runway", headers={"X-Ops-Api-Key": TEST_SERVICE_KEY})
    assert denied.status_code == 401
