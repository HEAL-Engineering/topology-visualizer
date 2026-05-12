"""Tests for the V0 fixture-backed SourceAdapter.

These prove the integration seam works without any Presidio / DB / Postgres
overhead — pure file-IO + Pydantic.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from uuid import UUID

from heal_pages.sources.base import ALL_SOURCES, SourceDayPayload
from heal_pages.sources.fixture import FixtureSourceAdapter

USER_ID = UUID("00000000-0000-0000-0000-000000000007")


def test_lists_dates_in_order(sample_fixture_path: Path) -> None:
    adapter = FixtureSourceAdapter("wearable", sample_fixture_path)
    dates = adapter.list_dates(USER_ID)
    assert dates == sorted(dates)
    assert all(isinstance(d, date) for d in dates)
    assert len(dates) >= 3


def test_fetch_day_returns_typed_payload(sample_fixture_path: Path) -> None:
    adapter = FixtureSourceAdapter("wearable", sample_fixture_path)
    payload = adapter.fetch_day(USER_ID, date(2026, 4, 1))
    assert isinstance(payload, SourceDayPayload)
    assert payload.source == "wearable"
    assert payload.user_id == USER_ID
    assert payload.day == date(2026, 4, 1)
    assert len(payload.records) > 0


def test_fetch_day_empty_for_missing_date(sample_fixture_path: Path) -> None:
    adapter = FixtureSourceAdapter("wearable", sample_fixture_path)
    payload = adapter.fetch_day(USER_ID, date(2099, 1, 1))
    assert payload.records == []


def test_fetch_day_empty_for_unknown_user(sample_fixture_path: Path) -> None:
    adapter = FixtureSourceAdapter("wearable", sample_fixture_path)
    other = UUID("00000000-0000-0000-0000-000000000099")
    payload = adapter.fetch_day(other, date(2026, 4, 1))
    assert payload.records == []


def test_signature_is_deterministic(sample_fixture_path: Path) -> None:
    adapter = FixtureSourceAdapter("wearable", sample_fixture_path)
    sig1 = adapter.signature(USER_ID, date(2026, 4, 1))
    sig2 = adapter.signature(USER_ID, date(2026, 4, 1))
    assert sig1 == sig2
    assert len(sig1) == 64  # sha256 hex


def test_signature_differs_per_day(sample_fixture_path: Path) -> None:
    adapter = FixtureSourceAdapter("wearable", sample_fixture_path)
    sig1 = adapter.signature(USER_ID, date(2026, 4, 1))
    sig2 = adapter.signature(USER_ID, date(2026, 4, 2))
    assert sig1 != sig2


def test_one_adapter_per_source(sample_fixture_path: Path) -> None:
    """Each source name produces a distinct adapter; payloads carry the
    source name set at construction time."""
    for name in ALL_SOURCES:
        adapter = FixtureSourceAdapter(name, sample_fixture_path)
        payload = adapter.fetch_day(USER_ID, date(2026, 4, 1))
        assert payload.source == name
