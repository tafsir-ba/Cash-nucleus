"""Startup must not seed the built-in default admin password outside local envs.

Run: cd backend && python3 -m pytest tests/test_admin_seed_guard.py -q
"""
from __future__ import annotations

import asyncio
import logging
import os

import pytest

os.environ["MONGO_URL"] = "mongodb://localhost"
os.environ["DB_NAME"] = "admin_seed_guard_test"
os.environ["JWT_SECRET"] = "seed-guard-test-secret"
os.environ["ENV"] = "test"

import server  # noqa: E402


class _Collection:
    def __init__(self):
        self.docs = []
        self.index_calls = 0

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def create_index(self, keys, **kwargs):
        self.index_calls += 1
        return "idx"


class _Database:
    def __init__(self):
        self._collections = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        collection = self._collections.get(name)
        if collection is None:
            collection = _Collection()
            self._collections[name] = collection
        return collection


@pytest.fixture
def db(monkeypatch):
    database = _Database()
    monkeypatch.setattr(server, "db", database)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("ENV", "test")
    return database


def _user(database):
    return next(iter(database.users.docs), None)


@pytest.mark.parametrize(
    "app_env",
    ["dev", "development", "test", "local", " DEV ", "Test", "Local"],
)
def test_default_password_allowed_only_for_explicit_local_envs(app_env):
    assert server.may_seed_admin_password(server.DEFAULT_ADMIN_PASSWORD, app_env) is True


@pytest.mark.parametrize("app_env", ["", "production", "prod", "staging", "live"])
def test_default_password_refused_outside_local_envs(app_env):
    assert server.may_seed_admin_password(server.DEFAULT_ADMIN_PASSWORD, app_env) is False


def test_non_default_password_is_allowed_in_production():
    assert server.may_seed_admin_password("test123", "production") is True


def test_env_takes_precedence_over_app_env(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("APP_ENV", "local")
    assert server.may_seed_admin_password(server.DEFAULT_ADMIN_PASSWORD) is False
    monkeypatch.delenv("ENV")
    assert server.may_seed_admin_password(server.DEFAULT_ADMIN_PASSWORD) is True


def test_startup_refuses_to_seed_default_password_in_production(db, monkeypatch, caplog):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    with caplog.at_level(logging.ERROR):
        asyncio.run(server.seed_admin())
    assert _user(db) is None
    assert db.users.index_calls > 0
    assert any("Refusing to seed" in record.getMessage() for record in caplog.records)
    for record in caplog.records:
        if server.DEFAULT_ADMIN_PASSWORD in record.getMessage():
            raise AssertionError("seed log included the default password")


def test_startup_refuses_when_password_is_explicitly_the_default(db, monkeypatch):
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("ADMIN_PASSWORD", server.DEFAULT_ADMIN_PASSWORD)
    asyncio.run(server.seed_admin())
    assert _user(db) is None


def test_startup_seeds_default_password_in_test_env(db, monkeypatch):
    monkeypatch.setenv("ENV", "test")
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    asyncio.run(server.seed_admin())
    stored = _user(db)
    assert stored is not None
    assert stored["email"] == "admin@example.com"
    matched = server.verify_password(server.DEFAULT_ADMIN_PASSWORD, stored["password_hash"])
    assert matched


def test_startup_seeds_custom_password_in_production(db, monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("ADMIN_PASSWORD", "test123")
    asyncio.run(server.seed_admin())
    stored = _user(db)
    assert stored is not None
    matched = server.verify_password("test123", stored["password_hash"])
    assert matched


@pytest.mark.parametrize("app_env", ["production", "test"])
def test_startup_does_not_rotate_existing_user(db, monkeypatch, app_env):
    original_hash = "existing-hash-must-stay"
    db.users.docs.append(
        {
            "id": "existing-admin",
            "email": "admin@example.com",
            "password_hash": original_hash,
            "name": "Admin",
        }
    )
    hashed = []
    real_hash = server.hash_password

    def spy(password: str) -> str:
        hashed.append(True)
        return real_hash(password)

    monkeypatch.setattr(server, "hash_password", spy)
    monkeypatch.setenv("ENV", app_env)
    monkeypatch.setenv("ADMIN_PASSWORD", "test123")
    asyncio.run(server.seed_admin())
    assert db.users.docs[0]["password_hash"] == original_hash
    assert hashed == []
    assert len(db.users.docs) == 1
