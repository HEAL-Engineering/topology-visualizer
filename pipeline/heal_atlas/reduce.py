"""Fit reference UMAP space on synthetic cohorts, project user days into it,
emit a canonical AtlasDataset JSON consumable by embedding-atlas.

Co-projection rationale: UMAP is fit on the cohort corpus once per run,
then user days are mapped via reducer.transform(). Re-fitting on the union
every upload would shift the cohort topology and break the "where am I
relative to elite athletes?" question across sessions.

Usage (after `uv sync`):
    uv run heal-atlas <input.json> <output.json>

In Docker:
    docker run --rm -v "$PWD:/data" heal-atlas-pipeline /data/in.json /data/out.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import umap
from sklearn.preprocessing import StandardScaler

from .cohorts import (
    COHORT_NAMES,
    FEATURES,
    WHEEL_DIMENSIONS,
    build_cohort_corpus,
    build_cohort_wheel_corpus,
)
from .featurize import featurize_user

CATEGORY_COLORS: dict[str, str] = {
    "avg_male":     "#60a5fa",
    "avg_female":   "#f472b6",
    "elite_male":   "#34d399",
    "elite_female": "#fbbf24",
    "user":         "#ef4444",
}

# Per-category cluster surface primitive. The SPA's ClusterShapes renderer
# fits the chosen primitive to each cluster via PCA — distinct primitive
# *kinds* give viewers a categorical recognition cue beyond color alone.
# Map keys must match CATEGORY_COLORS keys.
CATEGORY_SHAPES: dict[str, str] = {
    "avg_male":     "ellipsoid",
    "avg_female":   "torus",
    "elite_male":   "octahedron",
    "elite_female": "dodecahedron",
    "user":         "icosahedron",
}


def fit_reference(seed: int = 42) -> tuple[StandardScaler, umap.UMAP, pd.DataFrame]:
    """Wearable-feature UMAP (legacy path).

    Used by the original `heal-atlas` CLI which projects dedup_* JSON
    through the 9-dim wearable feature space. See `fit_reference_wheel`
    for the 8-dim wheel-of-wellness space used by the from-db bridge.
    """
    cohort_df = build_cohort_corpus(seed=seed)
    X = cohort_df[FEATURES].to_numpy()
    scaler = StandardScaler().fit(X)
    reducer = umap.UMAP(
        n_components=3,
        n_neighbors=15,
        min_dist=0.1,
        metric="euclidean",
        random_state=seed,
    ).fit(scaler.transform(X))
    cohort_df[["x", "y", "z"]] = reducer.embedding_
    return scaler, reducer, cohort_df


def fit_reference_wheel(seed: int = 42) -> tuple[StandardScaler, umap.UMAP, pd.DataFrame]:
    """Wheel-of-wellness UMAP (V6 path).

    Fits a 3D UMAP on the 8-dim cohort wheel-score corpus. User days are
    later transformed into this space via `project_user_wheel`. The
    coordinate space reflects the *full Wheel of Wellness* (physical,
    emotional, intellectual, social, spiritual, occupational, financial,
    environmental) rather than wearable signals alone, so spatial
    relationships in the SPA encode multi-dimensional wellness similarity.
    """
    cohort_df = build_cohort_wheel_corpus(seed=seed)
    X = cohort_df[WHEEL_DIMENSIONS].to_numpy()
    scaler = StandardScaler().fit(X)
    reducer = umap.UMAP(
        n_components=3,
        n_neighbors=15,
        min_dist=0.1,
        metric="euclidean",
        random_state=seed,
    ).fit(scaler.transform(X))
    cohort_df[["x", "y", "z"]] = reducer.embedding_
    return scaler, reducer, cohort_df


def project_user_wheel(
    user_df: pd.DataFrame,
    scaler: StandardScaler,
    reducer: umap.UMAP,
) -> pd.DataFrame:
    """Project user wheel-score days into the cohort wheel-space.

    Missing dimensions (NaN) are imputed with the cohort mean so a day with
    no signal in one dim doesn't get pushed to an extreme. Same rationale
    as `project_user` for the wearable path.
    """
    if user_df.empty:
        out = user_df.copy()
        out[["x", "y", "z"]] = np.empty((0, 3))
        return out
    Xu = user_df[WHEEL_DIMENSIONS].to_numpy(dtype=float)
    nan_idx = np.argwhere(np.isnan(Xu))
    if nan_idx.size:
        Xu[nan_idx[:, 0], nan_idx[:, 1]] = scaler.mean_[nan_idx[:, 1]]
    coords = reducer.transform(scaler.transform(Xu))
    out = user_df.copy()
    out[["x", "y", "z"]] = coords
    return out


def project_user(
    user_df: pd.DataFrame,
    scaler: StandardScaler,
    reducer: umap.UMAP,
) -> pd.DataFrame:
    if user_df.empty:
        out = user_df.copy()
        out[["x", "y", "z"]] = np.empty((0, 3))
        return out
    Xu = user_df[FEATURES].to_numpy(dtype=float)
    # Cohort-mean imputation: a missing biomarker should land near the cohort
    # centroid, not separate the user purely on what they failed to log.
    nan_idx = np.argwhere(np.isnan(Xu))
    if nan_idx.size:
        Xu[nan_idx[:, 0], nan_idx[:, 1]] = scaler.mean_[nan_idx[:, 1]]
    coords = reducer.transform(scaler.transform(Xu))
    out = user_df.copy()
    out[["x", "y", "z"]] = coords
    return out


def _centroid(df: pd.DataFrame) -> list[float] | None:
    if df.empty:
        return None
    c = df[["x", "y", "z"]].mean().tolist()
    return None if any(pd.isna(v) for v in c) else [float(v) for v in c]


def to_atlas_dataset(
    cohort_df: pd.DataFrame,
    user_df: pd.DataFrame,
    user_id: Any,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    points: list[dict[str, Any]] = []

    for i, row in cohort_df.iterrows():
        points.append({
            "id": f"cohort-{i}",
            "x": float(row["x"]), "y": float(row["y"]), "z": float(row["z"]),
            "category": row["cohort"],
            "label": f"{row['cohort']} prototype day",
            "value": float(row["steps"]),
            "unit": "steps",
            "source": "synthetic",
            "meta": {feat: float(row[feat]) for feat in FEATURES},
        })

    for date, row in user_df.iterrows():
        steps_val = row["steps"]
        point: dict[str, Any] = {
            "id": f"user-{date}",
            "x": float(row["x"]), "y": float(row["y"]), "z": float(row["z"]),
            "category": "user",
            "label": str(date),
            "value": float(steps_val) if pd.notna(steps_val) else 0.0,
            "unit": "steps",
            "timestamp": int(pd.Timestamp(date).timestamp() * 1000),
            "meta": {
                feat: (float(row[feat]) if pd.notna(row[feat]) else None)
                for feat in FEATURES
            },
        }
        if user_id is not None:
            point["userId"] = user_id
        points.append(point)

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
            "title": "Heal Atlas — user vs cohorts",
            "description": (
                "User-day points projected into a fixed UMAP space fit on synthetic "
                "cohort prototypes (avg/elite × male/female)."
            ),
            "projection": "umap",
            "metric": "wellness_dedup",
            "seed": 42,
            "sources": (sources or []) + ["synthetic"],
        },
        "categories": categories,
        "points": points,
    }


def run(input_path: Path, output_path: Path) -> None:
    payload = json.loads(input_path.read_text())
    user_features = featurize_user(payload)
    scaler, reducer, cohort_df = fit_reference()
    user_projected = project_user(user_features, scaler, reducer)

    sources = sorted({
        r.get("source")
        for key in ("dedup_heart_rates", "dedup_sleep_sessions", "dedup_daily_steps")
        for r in (payload.get(key) or [])
        if r.get("source")
    })

    dataset = to_atlas_dataset(cohort_df, user_projected, payload.get("user_id"), sources)
    output_path.write_text(json.dumps(dataset, indent=2, default=str))


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: heal-atlas <input.json> <output.json>", file=sys.stderr)
        sys.exit(2)
    run(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
