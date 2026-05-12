"""Tests for the V1 backfill driver.

Validates the chronological walk and resume-point computation. The driver
talks to backfill_progress via SQLAlchemy core upserts, so the test uses
an in-memory SQLite DB for the progress table only (matching the simpler
columns we touch) and a mocked consumer.process_day to avoid the writer
and DB-bound `daily_pages` plumbing.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from heal_pages import backfill
from heal_pages.consumer import ConsumerResult
from heal_pages.sources.base import SourceDayPayload

USER = UUID("00000000-0000-0000-0000-000000000007")


class _FakeAdapter:
    def __init__(self, source: str) -> None:
        self.source_name = source

    def list_dates(self, user_id):  # noqa: ARG002
        return []

    def fetch_day(self, user_id, day):
        return SourceDayPayload(user_id=user_id, day=day, source=self.source_name)

    def signature(self, user_id, day):  # noqa: ARG002
        return "sig"


@pytest.fixture(autouse=True)
def _stub_progress_io(monkeypatch: pytest.MonkeyPatch):
    """Replace DB-bound progress reads/writes with in-memory storage so the
    chronological-walk logic can be exercised without a live Postgres."""
    store: dict[tuple[UUID, str], dict[str, Any]] = {}

    class _StoredRow:
        def __init__(self, d: dict[str, Any]) -> None:
            self.source = d["source"]
            self.last_completed_date = d.get("last_completed_date")

    def fake_resume(session, user_id, sources, target_start):  # noqa: ARG001
        candidates = []
        for src in sources:
            row = store.get((user_id, src))
            if row and row.get("last_completed_date") is not None:
                candidates.append(row["last_completed_date"] + timedelta(days=1))
        return max(target_start, min(candidates)) if candidates else target_start

    def fake_upsert(session, user_id, source, **fields):  # noqa: ARG001
        key = (user_id, source)
        row = store.setdefault(key, {"source": source})
        row.update(fields)

    monkeypatch.setattr(backfill, "_resume_point", fake_resume)
    monkeypatch.setattr(backfill, "_upsert_progress", fake_upsert)
    return store


def _stub_process_day(monkeypatch, calls: list[date]) -> None:
    def _impl(session, *, user_id, day, adapters, extractors, force):  # noqa: ARG001
        calls.append(day)
        return ConsumerResult(outcome="written", day=day, sources_present=["wearable"], sources_extracted=["wearable"])
    monkeypatch.setattr(backfill, "process_day", _impl)


def test_backfill_walks_dates_ascending(monkeypatch) -> None:
    calls: list[date] = []
    _stub_process_day(monkeypatch, calls)
    session = MagicMock()

    summary = backfill.run_backfill(
        session,
        user_id=USER,
        adapters={"wearable": _FakeAdapter("wearable")},
        extractors={},
        days=5,
        today=date(2026, 4, 10),
    )

    assert calls == [
        date(2026, 4, 6), date(2026, 4, 7), date(2026, 4, 8),
        date(2026, 4, 9), date(2026, 4, 10),
    ]
    assert summary.start == date(2026, 4, 6)
    assert summary.end == date(2026, 4, 10)
    assert summary.written == 5


def test_backfill_resumes_from_progress(monkeypatch, _stub_progress_io) -> None:
    _stub_progress_io[(USER, "wearable")] = {
        "source": "wearable", "last_completed_date": date(2026, 4, 8),
    }
    calls: list[date] = []
    _stub_process_day(monkeypatch, calls)

    backfill.run_backfill(
        MagicMock(),
        user_id=USER,
        adapters={"wearable": _FakeAdapter("wearable")},
        extractors={},
        days=10,
        today=date(2026, 4, 10),
    )

    # Resumes from last_completed_date + 1 = 2026-04-09
    assert calls == [date(2026, 4, 9), date(2026, 4, 10)]


def test_backfill_marks_progress_failed_on_exception(monkeypatch, _stub_progress_io) -> None:
    def boom(*a, **kw):  # noqa: ARG001
        raise RuntimeError("kaboom")
    monkeypatch.setattr(backfill, "process_day", boom)

    with pytest.raises(RuntimeError, match="kaboom"):
        backfill.run_backfill(
            MagicMock(),
            user_id=USER,
            adapters={"wearable": _FakeAdapter("wearable")},
            extractors={},
            days=3,
            today=date(2026, 4, 10),
        )

    row = _stub_progress_io[(USER, "wearable")]
    assert row["status"] == "failed"
    assert "kaboom" in row["error"]
