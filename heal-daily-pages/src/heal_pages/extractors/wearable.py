"""V1 wearable extractor — HR windows, sleep stages, daily steps → 60d slice.

Input records (from FixtureSourceAdapter / heal-api):
  - {"type": "hr_window", "max_bpm", "min_bpm", "avg_bpm", "start_time", "end_time"}
  - {"type": "sleep",     "stage_type": 1|2|3|4, "duration_minutes"}
  - {"type": "steps",     "count"}

Sleep stage_type → name: 1=light, 2=deep, 3=rem, 4=awake. Matches the
upstream heal-api dedup_sleep_sessions encoding.

Feature layout — wearable slot is indices 0..59:
  HR (0..6)         resting / avg / peak / range / window count / aerobic-min / anaerobic-min
  Sleep (7..14)     deep / rem / light / awake / total / efficiency / restorative-pct / continuity
  Steps (15..18)    total / active-proxy / high-active flag / low-active flag
  Composite (19)    wellness composite (single tunable scalar)
  Reserved (20..59) 0.0; reserved for HRV, VO2, calories, training-load, etc.

Indices are PERMANENT once shipped — adding a feature claims a reserved slot,
never shifts existing slots (avoids re-embedding history).

Wheel contributions:
  physical:      from steps + HR + sleep composite
  emotional:     from sleep restorative-pct (proxy for recovery quality)
  spiritual:     from sleep efficiency (proxy for restful state)
  environmental: from active-proxy (proxy for time outside / on feet)

Wheel dimensions the wearable cannot speak to (intellectual, social,
occupational, financial) are intentionally OMITTED from the contributions
dict — `0.0` would falsely pull the weighted mean toward zero. See
extractors.base.ExtractorOutput docstring.
"""

from __future__ import annotations

from typing import Any

from ..sources.base import SourceDayPayload, SourceName
from .base import ExtractorOutput

SLOT_SIZE = 60

SLEEP_STAGE_NAMES: dict[int, str] = {1: "light", 2: "deep", 3: "rem", 4: "awake"}


class WearableExtractor:
    source_name: SourceName = "wearable"

    def extract(self, payload: SourceDayPayload) -> ExtractorOutput:
        features = [0.0] * SLOT_SIZE
        if not payload.records:
            return ExtractorOutput(features=features, text="", wheel_contributions={})

        hr, sleep, steps_total = _bucket_records(payload.records)

        # ── HR (0..6) ───────────────────────────────────────────────────────
        if hr:
            resting_hr = float(min(w["min_bpm"] for w in hr))
            avg_hr = float(sum(w["avg_bpm"] for w in hr) / len(hr))
            peak_hr = float(max(w["max_bpm"] for w in hr))
            aerobic_min = float(sum(
                _window_minutes(w) for w in hr if 100 <= w["avg_bpm"] < 140
            ))
            anaerobic_min = float(sum(
                _window_minutes(w) for w in hr if w["avg_bpm"] >= 140
            ))
            features[0] = resting_hr
            features[1] = avg_hr
            features[2] = peak_hr
            features[3] = peak_hr - resting_hr
            features[4] = float(len(hr))
            features[5] = aerobic_min
            features[6] = anaerobic_min
        else:
            resting_hr = avg_hr = peak_hr = 0.0
            aerobic_min = anaerobic_min = 0.0

        # ── Sleep (7..14) ───────────────────────────────────────────────────
        sleep_mins = {name: 0.0 for name in SLEEP_STAGE_NAMES.values()}
        for s in sleep:
            name = SLEEP_STAGE_NAMES.get(s["stage_type"])
            if name:
                sleep_mins[name] += float(s["duration_minutes"])
        sleep_total = sum(sleep_mins.values())
        sleep_asleep = sleep_total - sleep_mins["awake"]
        sleep_restorative = sleep_mins["deep"] + sleep_mins["rem"]
        efficiency = (sleep_asleep / sleep_total) if sleep_total > 0 else 0.0
        restorative_pct = (sleep_restorative / sleep_total) if sleep_total > 0 else 0.0
        continuity = (1.0 - sleep_mins["awake"] / sleep_total) if sleep_total > 0 else 0.0
        features[7] = sleep_mins["deep"]
        features[8] = sleep_mins["rem"]
        features[9] = sleep_mins["light"]
        features[10] = sleep_mins["awake"]
        features[11] = sleep_total
        features[12] = efficiency
        features[13] = restorative_pct
        features[14] = continuity

        # ── Steps (15..18) ──────────────────────────────────────────────────
        features[15] = float(steps_total)
        features[16] = float(steps_total / 100.0)
        features[17] = 1.0 if steps_total > 10_000 else 0.0
        features[18] = 1.0 if steps_total < 3_000 else 0.0

        # ── Composite (19) ──────────────────────────────────────────────────
        steps_norm = min(steps_total / 10_000.0, 1.0)
        hr_score = max(0.0, (180.0 - resting_hr)) * 0.2 if resting_hr > 0 else 0.0
        composite = efficiency * 50.0 + steps_norm * 30.0 + hr_score
        features[19] = composite

        # ── Page text ───────────────────────────────────────────────────────
        text = _render_text(
            resting_hr, avg_hr, peak_hr, sleep_mins, sleep_total, steps_total
        )

        # ── Wheel contributions ─────────────────────────────────────────────
        wheel = _wheel_contributions(
            composite=composite,
            restorative_pct=restorative_pct,
            efficiency=efficiency,
            steps_total=steps_total,
        )

        return ExtractorOutput(features=features, text=text, wheel_contributions=wheel)


# ─────────────────────── helpers ────────────────────────────────────────────
def _bucket_records(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    hr: list[dict[str, Any]] = []
    sleep: list[dict[str, Any]] = []
    steps_total = 0
    for r in records:
        match r.get("type"):
            case "hr_window":
                hr.append(r)
            case "sleep":
                sleep.append(r)
            case "steps":
                steps_total += int(r.get("count", 0))
    return hr, sleep, steps_total


def _window_minutes(window: dict[str, Any]) -> float:
    """HR window duration in minutes. Falls back to 0 if timestamps absent."""
    start = window.get("start_time")
    end = window.get("end_time")
    if not (start and end):
        return 0.0
    from datetime import datetime
    s = datetime.fromisoformat(start.replace("Z", "+00:00"))
    e = datetime.fromisoformat(end.replace("Z", "+00:00"))
    return max(0.0, (e - s).total_seconds() / 60.0)


def _render_text(
    resting_hr: float,
    avg_hr: float,
    peak_hr: float,
    sleep_mins: dict[str, float],
    sleep_total: float,
    steps_total: int,
) -> str:
    parts: list[str] = []

    if resting_hr or avg_hr or peak_hr:
        parts.append(
            f"Heart rate resting {resting_hr:.0f} bpm, average {avg_hr:.0f} bpm, "
            f"peak {peak_hr:.0f} bpm."
        )

    if sleep_total > 0:
        deep_pct = sleep_mins["deep"] / sleep_total
        awake_pct = sleep_mins["awake"] / sleep_total
        quality = (
            "restorative sleep" if deep_pct >= 0.20 and awake_pct < 0.10
            else "fragmented sleep" if awake_pct >= 0.10
            else "moderate sleep"
        )
        parts.append(
            f"Sleep {sleep_total:.0f} minutes total: "
            f"deep {sleep_mins['deep']:.0f}, REM {sleep_mins['rem']:.0f}, "
            f"light {sleep_mins['light']:.0f}, awake {sleep_mins['awake']:.0f}. "
            f"{quality.capitalize()}."
        )

    if steps_total > 0:
        activity = (
            "high-activity day" if steps_total > 10_000
            else "low-activity day" if steps_total < 3_000
            else "moderate-activity day"
        )
        parts.append(f"Steps {steps_total}. {activity.capitalize()}.")

    return " ".join(parts)


def _wheel_contributions(
    *,
    composite: float,
    restorative_pct: float,
    efficiency: float,
    steps_total: int,
) -> dict[str, float]:
    """Map raw signals to 0..10 wheel-dimension contributions.

    Only dimensions wearable can meaningfully speak to are included.
    Omitting a dimension means 'no signal' — the consumer's weighted-mean
    aggregator skips absent dimensions rather than treating them as 0.
    """
    contributions: dict[str, float] = {}
    if composite > 0:
        contributions["physical"] = min(composite / 10.0, 10.0)
    if restorative_pct > 0:
        contributions["emotional"] = min(restorative_pct * 10.0, 10.0)
    if efficiency > 0:
        contributions["spiritual"] = min(efficiency * 10.0, 10.0)
    if steps_total > 0:
        contributions["environmental"] = min(steps_total / 1500.0, 10.0)
    return contributions
