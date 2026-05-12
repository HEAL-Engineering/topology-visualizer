"""Tests for the V1 consumer / orchestrator.

These do not touch a real DB. The SQLAlchemy session is mocked, redaction
is monkey-patched to skip the slow Presidio warmup, and adapters are tiny
in-memory fakes.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from heal_pages import consumer
from heal_pages.config import BASE_FEATURE_SLOTS, BASE_FEATURES_DIM
from heal_pages.extractors.base import ExtractorOutput
from heal_pages.extractors.wearable import SLOT_SIZE, WearableExtractor
from heal_pages.redact import RedactionResult
from heal_pages.sources.base import SourceDayPayload

USER = UUID("00000000-0000-0000-0000-000000000007")
DAY = date(2026, 4, 1)


class _FakeAdapter:
    def __init__(self, source: str, records: list[dict], sig: str) -> None:
        self.source_name = source
        self._records = records
        self._sig = sig

    def list_dates(self, user_id):  # noqa: ARG002
        return [DAY]

    def fetch_day(self, user_id, day):
        return SourceDayPayload(user_id=user_id, day=day, source=self.source_name, records=self._records)

    def signature(self, user_id, day):  # noqa: ARG002
        return self._sig


@pytest.fixture(autouse=True)
def _stub_redact(monkeypatch: pytest.MonkeyPatch):
    """Bypass Presidio in unit tests; clean passthrough."""
    monkeypatch.setattr(
        consumer, "redact",
        lambda text: RedactionResult(text=text, entities_found=0, types=[],
                                     presidio_version="stub", quarantine=False),
    )


def test_process_day_writes_features_into_wearable_slot(monkeypatch) -> None:
    captured: dict = {}

    def fake_write(session, **kwargs):  # noqa: ARG001
        captured.update(kwargs)
        return "written"

    monkeypatch.setattr(consumer, "write_daily_page", fake_write)
    monkeypatch.setattr(consumer, "get_existing_signature", lambda *a, **kw: None)

    session = MagicMock()
    records = [
        {"type": "hr_window", "max_bpm": 71, "min_bpm": 54, "avg_bpm": 62.4,
         "start_time": "2026-04-01T08:00:00Z", "end_time": "2026-04-01T09:00:00Z"},
        {"type": "steps", "count": 11240},
    ]
    adapters = {
        "wearable": _FakeAdapter("wearable", records, "sig-wearable"),
        "financial": _FakeAdapter("financial", [], "sig-financial"),
        "email":     _FakeAdapter("email", [], "sig-email"),
        "messages":  _FakeAdapter("messages", [], "sig-messages"),
    }
    extractors = {"wearable": WearableExtractor()}

    result = consumer.process_day(
        session,
        user_id=USER, day=DAY,
        adapters=adapters, extractors=extractors,
    )

    assert result.outcome == "written"
    assert result.sources_extracted == ["wearable"]
    assert "wearable" in result.sources_present

    features = captured["base_features"]
    assert len(features) == BASE_FEATURES_DIM
    start, end = BASE_FEATURE_SLOTS["wearable"]
    # wearable slice populated
    assert features[0] == 54.0       # resting_hr
    assert features[15] == 11240.0   # steps
    # other slots untouched
    assert all(v == 0.0 for v in features[end:])

    # data_signature carries all sources, even those without extractors
    assert captured["data_signature"] == {
        "wearable": "sig-wearable",
        "financial": "sig-financial",
        "email": "sig-email",
        "messages": "sig-messages",
    }


def test_process_day_skips_when_signatures_unchanged(monkeypatch) -> None:
    signatures = {
        "wearable": "sig-wearable", "financial": "sig-financial",
        "email": "sig-email", "messages": "sig-messages",
    }
    monkeypatch.setattr(consumer, "get_existing_signature", lambda *a, **kw: signatures)
    monkeypatch.setattr(consumer, "write_daily_page",
                        lambda *a, **kw: pytest.fail("writer should not be called when skipping"))

    adapters = {src: _FakeAdapter(src, [], sig) for src, sig in signatures.items()}
    extractors = {"wearable": WearableExtractor()}

    result = consumer.process_day(
        MagicMock(),
        user_id=USER, day=DAY,
        adapters=adapters, extractors=extractors,
    )
    assert result.outcome == "skipped"
    assert result.sources_extracted == []


def test_process_day_force_bypasses_skip(monkeypatch) -> None:
    signatures = {src: f"sig-{src}" for src in ["wearable", "financial", "email", "messages"]}
    monkeypatch.setattr(consumer, "get_existing_signature", lambda *a, **kw: signatures)
    called = MagicMock(return_value="written")
    monkeypatch.setattr(consumer, "write_daily_page", called)

    adapters = {src: _FakeAdapter(src, [], sig) for src, sig in signatures.items()}
    extractors = {"wearable": WearableExtractor()}

    result = consumer.process_day(
        MagicMock(),
        user_id=USER, day=DAY,
        adapters=adapters, extractors=extractors,
        force=True,
    )
    assert result.outcome == "written"
    called.assert_called_once()


def test_slot_size_violation_raises(monkeypatch) -> None:
    monkeypatch.setattr(consumer, "get_existing_signature", lambda *a, **kw: None)

    class BadExtractor:
        source_name = "wearable"
        def extract(self, payload):  # noqa: ARG002
            return ExtractorOutput(features=[1.0, 2.0, 3.0])  # wrong size

    adapters = {"wearable": _FakeAdapter("wearable", [{"type": "steps", "count": 1}], "x")}
    with pytest.raises(ValueError, match="slot expects 60"):
        consumer.process_day(
            MagicMock(),
            user_id=USER, day=DAY,
            adapters=adapters,
            extractors={"wearable": BadExtractor()},
        )


# ─────────────────────── aggregate_wheel_scores ─────────────────────────────
def test_aggregate_wheel_scores_weighted_mean() -> None:
    """For dims touched by multiple sources, value is the weighted mean over
    sources that emitted a contribution. Absent sources don't drag toward 0."""
    contribs = {"wearable": {"physical": 8.0, "emotional": 6.0}}
    scores = consumer.aggregate_wheel_scores(contribs)
    # physical: only wearable contributes (weight 1.0). Result = 8.0.
    assert scores.physical == pytest.approx(8.0)
    # intellectual: no source contributes → 0.0
    assert scores.intellectual == 0.0


def test_aggregate_wheel_scores_absent_dim_means_zero() -> None:
    scores = consumer.aggregate_wheel_scores({})
    assert scores.physical == 0.0
    assert scores.social == 0.0
