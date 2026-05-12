"""V6 bridge — read daily_pages from Postgres, emit an AtlasDataset JSON
projected through the 8-dim Wheel-of-Wellness UMAP space.

Inputs:
  - Postgres `daily_pages` populated by heal-daily-pages (V1 wearable +
    V4 financial + V5 email + V6 messages extractors). Each row carries
    `metadata.wheel_scores` (8 dims, 0..10 scale) — the consumer's
    weighted-mean aggregation across all 4 sources.

Output:
  - `atlas.json` consumable by the embedding-atlas frontend.

Strategy:
  1. Pull `(date, metadata.wheel_scores, base_features, metadata)` for one
     user.
  2. Build an 8-column DataFrame of wheel scores per day.
  3. Fit UMAP on the cohort wheel-score corpus (4 cohorts × 200 days × 8
     dims) — that's the *fixed* reference topology of the wheel-space.
  4. Transform user days through the fitted reducer.
  5. Emit an AtlasDataset where:
       - cohort points carry their 8-dim wheel scores in `meta`
       - user points carry their 8-dim wheel scores + the 9 wearable
         features (for inspection) in `meta`
       - each category gets a distinct shape primitive

Why wheel-space, not wearable-space:
  The original from_db path projected the 9 wearable features into a
  cohort-defined wearable UMAP. That topology reflects *fitness only*.
  Wheel-space reflects the *full Wheel of Wellness* — physical, emotional,
  intellectual, social, spiritual, occupational, financial, environmental.
  Spatial proximity now encodes multi-dimensional wellness similarity.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from uuid import UUID

import pandas as pd
import psycopg
from psycopg.rows import dict_row

from .cohorts import FEATURES, WHEEL_DIMENSIONS
from .reduce import (
    CATEGORY_COLORS,
    CATEGORY_SHAPES,
    fit_reference_wheel,
    project_user_wheel,
    _centroid,
)

# Where each pipeline FEATURE (wearable) lives inside the heal-daily-pages
# 240d base_features vector. Same as the wearable-space path — used here
# only for enriching the user-point meta so the event card can show raw
# biomarkers alongside wellness scores.
WEARABLE_SLOT_INDEX: dict[str, int] = {
    "resting_hr":      0,
    "avg_hr":          1,
    "peak_hr":         2,
    "sleep_deep_min":  7,
    "sleep_rem_min":   8,
    "sleep_light_min": 9,
    "sleep_awake_min": 10,
    "sleep_total_min": 11,
    "steps":           15,
}

DEFAULT_DATABASE_URL = "postgresql://heal:heal@localhost:5432/heal_pages"
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000007"


def load_user_wheel_days(database_url: str, user_id: UUID) -> pd.DataFrame:
    """Read daily_pages rows that have at least one source present.

    Returns a DataFrame indexed by date with:
      - 8 wheel-dimension columns (from metadata.wheel_scores)
      - 9 pipeline FEATURE columns (extracted from base_features)
      - `source_presence`: dict captured so the SPA can show which sources
        contributed to each day's wheel scores.
    """
    sql = """
        SELECT date,
               base_features::real[] AS features,
               metadata->'wheel_scores' AS wheel_scores,
               metadata->'source_presence' AS source_presence
        FROM daily_pages
        WHERE user_id = %(user_id)s
          AND (
            COALESCE((metadata #>> '{source_presence,wearable}')::boolean,  false) OR
            COALESCE((metadata #>> '{source_presence,financial}')::boolean, false) OR
            COALESCE((metadata #>> '{source_presence,email}')::boolean,     false) OR
            COALESCE((metadata #>> '{source_presence,messages}')::boolean,  false)
          )
        ORDER BY date
    """
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        rows = conn.execute(sql, {"user_id": str(user_id)}).fetchall()

    if not rows:
        cols = WHEEL_DIMENSIONS + FEATURES + ["source_presence"]
        return pd.DataFrame(columns=cols, index=pd.Index([], name="date"))

    records: list[dict[str, Any]] = []
    for r in rows:
        record: dict[str, Any] = {"date": r["date"]}
        wheel = r["wheel_scores"] or {}
        for dim in WHEEL_DIMENSIONS:
            record[dim] = float(wheel.get(dim, 0.0))
        vec: list[float] = r["features"] or []
        for feat, idx in WEARABLE_SLOT_INDEX.items():
            v = float(vec[idx]) if idx < len(vec) else float("nan")
            # Honest "no signal" sentinel for biomarkers that biology
            # forbids being zero — the SPA card shows NaN as "—".
            if feat in {"resting_hr", "avg_hr", "peak_hr", "sleep_total_min"} and v == 0.0:
                v = float("nan")
            record[feat] = v
        record["source_presence"] = r["source_presence"] or {}
        records.append(record)

    df = pd.DataFrame.from_records(records).set_index("date")
    return df


def to_atlas_dataset_wheel(
    cohort_df: pd.DataFrame,
    user_df: pd.DataFrame,
    user_id: Any,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    """AtlasDataset emission for wheel-space. Mirrors reduce.to_atlas_dataset
    but with per-point `meta` shaped around the wheel-of-wellness instead
    of raw biomarkers.
    """
    points: list[dict[str, Any]] = []

    # Cohort points carry their 8-dim wheel scores + a `wellness_composite`
    # scalar (mean of the 8) so the table panel can sort by overall score.
    for i, row in cohort_df.iterrows():
        wheel_meta = {dim: float(row[dim]) for dim in WHEEL_DIMENSIONS}
        composite = float(sum(wheel_meta.values()) / len(WHEEL_DIMENSIONS))
        points.append({
            "id": f"cohort-{i}",
            "x": float(row["x"]), "y": float(row["y"]), "z": float(row["z"]),
            "category": row["cohort"],
            "label": f"{row['cohort']} prototype day",
            "value": composite,
            "unit": "wellness score",
            "source": "synthetic",
            "meta": {**wheel_meta, "wellness_composite": composite},
        })

    # User points carry wheel scores + raw biomarker meta for inspection.
    for date, row in user_df.iterrows():
        wheel_meta = {dim: float(row[dim]) for dim in WHEEL_DIMENSIONS}
        bio_meta = {
            feat: (float(row[feat]) if pd.notna(row[feat]) else None)
            for feat in FEATURES
        }
        composite = float(sum(wheel_meta.values()) / len(WHEEL_DIMENSIONS))
        point: dict[str, Any] = {
            "id": f"user-{date}",
            "x": float(row["x"]), "y": float(row["y"]), "z": float(row["z"]),
            "category": "user",
            "label": str(date),
            "value": composite,
            "unit": "wellness score",
            "timestamp": int(pd.Timestamp(date).timestamp() * 1000),
            "meta": {
                **wheel_meta,
                "wellness_composite": composite,
                "biomarkers": bio_meta,
                "source_presence": row.get("source_presence", {}),
            },
        }
        if user_id is not None:
            point["userId"] = str(user_id)
        points.append(point)

    # Categories + per-cohort centroids + shape kinds (same contract as the
    # wearable-space path — the SPA renderer's ClusterShapes consumes these).
    categories: list[dict[str, Any]] = []
    for cid, color in CATEGORY_COLORS.items():
        pos = _centroid(user_df) if cid == "user" else _centroid(cohort_df[cohort_df["cohort"] == cid])
        cat: dict[str, Any] = {
            "id": cid,
            "label": cid.replace("_", " ").title(),
            "color": color,
            "shape": CATEGORY_SHAPES.get(cid, "ellipsoid"),
        }
        if pos is not None:
            cat["position"] = pos
        categories.append(cat)

    return {
        "meta": {
            "title": "Heal Atlas — Wheel of Wellness",
            "description": (
                "User-day points projected into a fixed UMAP space fit on synthetic "
                "cohort prototypes across all 8 Wheel-of-Wellness dimensions "
                "(physical, emotional, intellectual, social, spiritual, occupational, "
                "financial, environmental). Spatial proximity reflects multi-dimensional "
                "wellness similarity, not fitness alone."
            ),
            "projection": "umap",
            "metric": "wheel_of_wellness",
            "seed": 42,
            "sources": (sources or []) + ["synthetic"],
            "dimensions": WHEEL_DIMENSIONS,
        },
        "categories": categories,
        "points": points,
    }


def run(database_url: str, user_id: UUID, output_path: Path) -> None:
    user_df = load_user_wheel_days(database_url, user_id)
    scaler, reducer, cohort_df = fit_reference_wheel()
    user_projected = project_user_wheel(user_df, scaler, reducer)
    dataset = to_atlas_dataset_wheel(
        cohort_df, user_projected, user_id,
        sources=["daily_pages_v6"],
    )
    output_path.write_text(json.dumps(dataset, indent=2, default=str))
    print(
        f"Wrote {output_path}  cohorts={len(cohort_df)}  user_days={len(user_df)}  "
        f"projection=wheel_of_wellness",
        file=sys.stderr,
    )


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "usage: heal-atlas-from-db <output.json> [user_id] [database_url]",
            file=sys.stderr,
        )
        print(
            "  Defaults: user_id=00000000-...-0007, "
            "database_url=$DATABASE_URL or postgresql://heal:heal@localhost:5432/heal_pages",
            file=sys.stderr,
        )
        sys.exit(2)
    output = Path(sys.argv[1])
    user_id = UUID(sys.argv[2]) if len(sys.argv) >= 3 else UUID(DEFAULT_USER_ID)
    database_url = (
        sys.argv[3] if len(sys.argv) >= 4
        else os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    )
    database_url = database_url.replace("postgresql+psycopg://", "postgresql://")
    run(database_url, user_id, output)


if __name__ == "__main__":
    main()
