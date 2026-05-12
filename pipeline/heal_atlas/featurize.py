"""Convert a heal-api dedup JSON dump into a per-(user, date) feature DataFrame.

Input shape (matches the SQLAlchemy dedup_* models):

{
  "user_id": int,
  "dedup_heart_rates":   [{user_id, source, max_bpm, min_bpm, avg_bpm,
                           start_time, end_time}, ...],
  "dedup_sleep_sessions":[{user_id, date, stage_type, duration_minutes, source}, ...],
  "dedup_daily_steps":   [{user_id, date, steps, source}, ...]
}

Output columns match cohorts.FEATURES; NaN is preserved so the reducer can
choose its imputation policy.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .cohorts import FEATURES

SLEEP_STAGE_NAMES: dict[int, str] = {1: "light", 2: "deep", 3: "rem", 4: "awake"}


def _to_date(s: str) -> str:
    return s[:10]


def featurize_user(payload: dict[str, Any]) -> pd.DataFrame:
    hr_rows = payload.get("dedup_heart_rates") or []
    sleep_rows = payload.get("dedup_sleep_sessions") or []
    step_rows = payload.get("dedup_daily_steps") or []

    if hr_rows:
        hr_df = pd.DataFrame(hr_rows)
        hr_df["date"] = hr_df["start_time"].map(_to_date)
        hr_daily = hr_df.groupby("date").agg(
            resting_hr=("min_bpm", "min"),
            avg_hr=("avg_bpm", "mean"),
            peak_hr=("max_bpm", "max"),
        )
    else:
        hr_daily = pd.DataFrame(columns=["resting_hr", "avg_hr", "peak_hr"])

    if sleep_rows:
        sleep_df = pd.DataFrame(sleep_rows)
        sleep_df["stage_name"] = sleep_df["stage_type"].map(SLEEP_STAGE_NAMES)
        sleep_wide = sleep_df.pivot_table(
            index="date",
            columns="stage_name",
            values="duration_minutes",
            aggfunc="sum",
            fill_value=0,
        )
        sleep_wide.columns = [f"sleep_{c}_min" for c in sleep_wide.columns]
        for col in (
            "sleep_deep_min",
            "sleep_rem_min",
            "sleep_light_min",
            "sleep_awake_min",
        ):
            if col not in sleep_wide.columns:
                sleep_wide[col] = 0
        sleep_wide["sleep_total_min"] = (
            sleep_wide["sleep_deep_min"]
            + sleep_wide["sleep_rem_min"]
            + sleep_wide["sleep_light_min"]
            + sleep_wide["sleep_awake_min"]
        )
    else:
        sleep_wide = pd.DataFrame(columns=[
            "sleep_deep_min",
            "sleep_rem_min",
            "sleep_light_min",
            "sleep_awake_min",
            "sleep_total_min",
        ])

    if step_rows:
        step_df = pd.DataFrame(step_rows)
        step_daily = step_df.set_index("date")[["steps"]]
    else:
        step_daily = pd.DataFrame(columns=["steps"])

    daily = hr_daily.join(sleep_wide, how="outer").join(step_daily, how="outer")
    return daily.reindex(columns=FEATURES)
