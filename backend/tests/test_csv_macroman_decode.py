"""Regression: Mac Roman CSV (é as 0x8E) must decode to Trésorerie, not TrŽsorerie."""
from __future__ import annotations

import os
import uuid
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", f"csv_macroman_{uuid.uuid4().hex[:8]}")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("ENABLE_BULK_ACTUALS", "true")
os.environ["COOKIE_SECURE"] = "false"
os.environ["ENV"] = "test"

from server import decode_csv_bytes  # noqa: E402

FIXTURE = Path("/home/ubuntu/.cursor/projects/workspace/uploads/EN_Auszug_140726_test_070d.csv")


def test_decode_csv_quality_prefers_mac_roman_over_cp1252_for_0x8e():
    sample = b"Flow match\nAvance Tr\x8esorerie - Revenue\n"
    text = decode_csv_bytes(sample)
    assert "Trésorerie" in text
    assert "TrŽsorerie" not in text


def test_decode_uploaded_auszug_csv_avance_label():
    if not FIXTURE.exists():
        return
    raw = FIXTURE.read_bytes()
    assert b"Avance Tr\x8esorerie" in raw
    text = decode_csv_bytes(raw)
    assert "Avance Trésorerie - Revenue" in text
    assert "TrŽsorerie" not in text
