"""Tests for the V1 wearable extractor.

Verifies the slot-size contract, feature content for representative days,
the page_text shape (lexical-search inputs need stable narrative phrases),
and the wheel-contribution semantics (absent ≠ zero).
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from heal_pages.config import BASE_FEATURE_SLOTS
from heal_pages.extractors.wearable import SLOT_SIZE, WearableExtractor
from heal_pages.sources.base import SourceDayPayload

USER = UUID("00000000-0000-0000-0000-000000000007")
DAY = date(2026, 4, 1)


def _payload(records: list[dict]) -> SourceDayPayload:
    return SourceDayPayload(user_id=USER, day=DAY, source="wearable", records=records)


def test_slot_size_matches_config() -> None:
    """The wearable slot size in config must equal SLOT_SIZE in the extractor."""
    start, end = BASE_FEATURE_SLOTS["wearable"]
    assert end - start == SLOT_SIZE


def test_empty_records_yields_zero_vector_and_empty_text() -> None:
    output = WearableExtractor().extract(_payload([]))
    assert len(output.features) == SLOT_SIZE
    assert output.features == [0.0] * SLOT_SIZE
    assert output.text == ""
    assert output.wheel_contributions == {}


def test_active_day_with_full_signals() -> None:
    records = [
        {"type": "hr_window", "max_bpm": 71, "min_bpm": 54, "avg_bpm": 62.4,
         "start_time": "2026-04-01T08:00:00Z", "end_time": "2026-04-01T09:00:00Z"},
        {"type": "sleep", "stage_type": 2, "duration_minutes": 96},   # deep
        {"type": "sleep", "stage_type": 3, "duration_minutes": 84},   # rem
        {"type": "sleep", "stage_type": 1, "duration_minutes": 212},  # light
        {"type": "sleep", "stage_type": 4, "duration_minutes": 18},   # awake
        {"type": "steps", "count": 11240},
    ]
    output = WearableExtractor().extract(_payload(records))
    f = output.features

    assert len(f) == SLOT_SIZE

    # HR slots 0..6
    assert f[0] == 54.0    # resting_hr
    assert f[2] == 71.0    # peak_hr
    assert f[3] == 71.0 - 54.0  # range
    assert f[4] == 1.0     # window count

    # Sleep slots 7..14
    assert f[7] == 96.0    # deep
    assert f[8] == 84.0    # rem
    assert f[9] == 212.0   # light
    assert f[10] == 18.0   # awake
    assert f[11] == 410.0  # total
    assert 0.9 < f[12] <= 1.0  # efficiency = (96+84+212)/410 ≈ 0.956

    # Steps slots 15..18
    assert f[15] == 11240.0
    assert f[17] == 1.0    # high-active flag
    assert f[18] == 0.0    # low-active flag

    # Reserved slots 20..59 must stay zero
    assert all(v == 0.0 for v in f[20:])

    # Page text touches each subsystem
    assert "Heart rate" in output.text
    assert "Sleep" in output.text
    assert "Steps" in output.text
    assert "high-activity day" in output.text.lower()

    # Wheel contributions: only dims wearable speaks to
    contribs = output.wheel_contributions
    assert "physical" in contribs
    assert "emotional" in contribs
    assert "spiritual" in contribs
    assert "environmental" in contribs
    # Dimensions wearable CAN'T speak to must be absent (not zero)
    assert "intellectual" not in contribs
    assert "social" not in contribs
    assert "financial" not in contribs
    assert "occupational" not in contribs


def test_low_activity_day_flags() -> None:
    records = [
        {"type": "steps", "count": 1500},
    ]
    output = WearableExtractor().extract(_payload(records))
    assert output.features[15] == 1500.0
    assert output.features[17] == 0.0  # not high
    assert output.features[18] == 1.0  # low
    assert "low-activity day" in output.text.lower()


def test_partial_signals_still_emit_correct_slot_size() -> None:
    """Days with only one signal type still emit a full 60d vector."""
    records = [{"type": "steps", "count": 5000}]
    output = WearableExtractor().extract(_payload(records))
    assert len(output.features) == SLOT_SIZE
    # HR / sleep slots should be 0.0 since absent
    assert output.features[0] == 0.0
    assert output.features[11] == 0.0
