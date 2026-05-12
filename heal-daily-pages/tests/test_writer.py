"""Tests for the daily_pages writer plumbing.

These do NOT hit a real Postgres — the writer is exercised against a mocked
SQLAlchemy session so the suite stays fast and CI-friendly. A full
integration test against the docker-compose Postgres lives at the bottom,
gated on `INTEGRATION_DB=1` so it doesn't run in the default test pass.
"""

from __future__ import annotations

import os
from datetime import date
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from heal_pages.redact import RedactionResult
from heal_pages.writer import (
    DailyPageMetadata,
    SourcePresence,
    WheelScores,
    write_daily_page,
)

USER = UUID("00000000-0000-0000-0000-000000000007")
DAY = date(2026, 4, 1)


def _clean_redaction(text: str = "User had a quiet day.") -> RedactionResult:
    return RedactionResult(
        text=text,
        entities_found=0,
        types=[],
        presidio_version="2.2.0",
        quarantine=False,
        validator_findings=[],
    )


def _quarantined_redaction() -> RedactionResult:
    return RedactionResult(
        text="Note: 123-45-6789 slipped through.",
        entities_found=0,
        types=[],
        presidio_version="2.2.0",
        quarantine=True,
        validator_findings=[{"type": "SSN", "count": 1, "sample": "[REDACTED_FINDING]"}],
    )


def test_clean_row_writes_to_daily_pages() -> None:
    session = MagicMock()
    redaction = _clean_redaction()
    metadata = DailyPageMetadata(
        wheel_scores=WheelScores(physical=5.0, emotional=4.0),
        source_presence=SourcePresence(wearable=True),
    )

    outcome = write_daily_page(
        session,
        user_id=USER,
        day=DAY,
        page_text=redaction.text,
        redaction=redaction,
        metadata=metadata,
        data_signature={"wearable": "abc123"},
        base_features=None,
        trajectory_features=None,
        text_embed=None,
    )

    assert outcome == "written"
    session.execute.assert_called_once()
    session.add.assert_not_called()


def test_quarantined_row_routes_away_from_daily_pages() -> None:
    session = MagicMock()
    redaction = _quarantined_redaction()
    metadata = DailyPageMetadata()

    outcome = write_daily_page(
        session,
        user_id=USER,
        day=DAY,
        page_text=redaction.text,
        redaction=redaction,
        metadata=metadata,
        data_signature={"wearable": "abc123"},
    )

    assert outcome == "quarantined"
    session.add.assert_called_once()
    session.execute.assert_not_called()


def test_redaction_stats_stamped_into_metadata() -> None:
    """The writer must always overwrite metadata.redaction_stats with the
    actual RedactionResult — callers can't lie about how many entities
    Presidio found."""
    session = MagicMock()
    redaction = RedactionResult(
        text="Hello [PERSON].",
        entities_found=1,
        types=["PERSON"],
        presidio_version="2.2.0",
        quarantine=False,
    )
    metadata = DailyPageMetadata()

    write_daily_page(
        session,
        user_id=USER,
        day=DAY,
        page_text=redaction.text,
        redaction=redaction,
        metadata=metadata,
        data_signature={},
    )

    assert metadata.redaction_stats.entities_found == 1
    assert metadata.redaction_stats.types == ["PERSON"]
    assert metadata.presidio_version == "2.2.0"


def test_default_metadata_validates() -> None:
    """A bare DailyPageMetadata() must serialize without raising — every
    field has a default. This guards against accidentally making a field
    required and breaking the V0 writer."""
    metadata = DailyPageMetadata()
    dumped = metadata.model_dump(mode="json")
    assert "wheel_scores" in dumped
    assert "source_presence" in dumped
    assert dumped["template_version"] == "v3"


# ─────────────────────── Optional integration test ──────────────────────────
# Runs only when INTEGRATION_DB=1 and a docker-compose Postgres is up.
@pytest.mark.skipif(
    os.environ.get("INTEGRATION_DB") != "1",
    reason="set INTEGRATION_DB=1 with docker-compose postgres running",
)
def test_writer_against_real_postgres() -> None:
    from heal_pages.db import SessionLocal

    with SessionLocal() as session:
        redaction = _clean_redaction("Integration test row.")
        metadata = DailyPageMetadata(
            source_presence=SourcePresence(wearable=True),
        )
        write_daily_page(
            session,
            user_id=USER,
            day=DAY,
            page_text=redaction.text,
            redaction=redaction,
            metadata=metadata,
            data_signature={"wearable": "integration"},
        )
        session.rollback()  # don't pollute the dev DB
