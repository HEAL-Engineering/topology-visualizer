"""Synthetic cohort prototypes for the wellness atlas pipeline.

Generates per-day feature vectors approximating four reference populations:
average American adult male/female and elite endurance athlete male/female.
The vectors share the schema in FEATURES and are sampled from Gaussian
priors derived from population literature (NHANES-ish for averages,
ACSM/USOPC ranges for elites).

Priors are MVP-grade — they encode the right *direction* of cohort
separation (low resting HR / high steps for elites, etc.) without claiming
demographic accuracy. Replace with empirical distributions once real
anonymized cohort data is available.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

FEATURES: list[str] = [
    "resting_hr",
    "avg_hr",
    "peak_hr",
    "sleep_deep_min",
    "sleep_rem_min",
    "sleep_light_min",
    "sleep_awake_min",
    "sleep_total_min",
    "steps",
]

COHORT_NAMES: list[str] = ["avg_male", "avg_female", "elite_male", "elite_female"]

# Means and stds aligned to FEATURES, in order.
COHORT_PRIORS: dict[str, dict[str, list[float]]] = {
    "avg_male": {
        "mean": [70, 80, 135, 60,  90, 250, 20, 420,  5300],
        "std":  [ 8,  9,  15, 15,  20,  35,  8,  60,  1800],
    },
    "avg_female": {
        "mean": [74, 83, 140, 60,  95, 260, 25, 440,  4900],
        "std":  [ 9, 10,  15, 15,  22,  38,  9,  60,  1700],
    },
    "elite_male": {
        "mean": [45, 65, 185, 95, 120, 250, 15, 480, 14500],
        "std":  [ 5,  8,  10, 18,  20,  30,  6,  35,  3500],
    },
    "elite_female": {
        "mean": [48, 68, 190, 100, 120, 250, 15, 490, 13500],
        "std":  [ 5,  9,  12,  20,  20,  30,  6,  35,  3300],
    },
}


def sample_cohort(name: str, n_days: int = 200, seed: int = 42) -> pd.DataFrame:
    """N synthetic per-day vectors for one cohort. Negatives clipped to 0."""
    rng = np.random.default_rng(seed + abs(hash(name)) % 10000)
    prior = COHORT_PRIORS[name]
    raw = rng.normal(loc=prior["mean"], scale=prior["std"], size=(n_days, len(FEATURES)))
    raw = np.clip(raw, 0, None)
    df = pd.DataFrame(raw, columns=FEATURES)
    df["cohort"] = name
    return df


def build_cohort_corpus(n_days_per_cohort: int = 200, seed: int = 42) -> pd.DataFrame:
    """Stack all cohorts into a single DataFrame for UMAP fitting."""
    return pd.concat(
        [sample_cohort(name, n_days_per_cohort, seed) for name in COHORT_NAMES],
        ignore_index=True,
    )


# ─────────────────────── Wheel-of-wellness priors ───────────────────────────
# Per-cohort 8-dim wheel-score priors (0..10 scale). These mirror the
# `WHEEL_DIMENSIONS` order below and are used by the wheel-space UMAP
# projection in `reduce.fit_reference_wheel`.
#
# Priors encode the *direction* of cohort separation: elites are very high
# physical / environmental, average on cognition-tied dims; averages are
# centered everywhere. Numbers are MVP-grade — replace before any clinical
# or comparative claim is made (same caveat as the wearable priors).
WHEEL_DIMENSIONS: list[str] = [
    "physical",
    "emotional",
    "intellectual",
    "social",
    "spiritual",
    "occupational",
    "financial",
    "environmental",
]

COHORT_WHEEL_PRIORS: dict[str, dict[str, list[float]]] = {
    "avg_male": {
        "mean": [4.0, 5.0, 5.0, 5.0, 4.0, 5.0, 5.0, 4.0],
        "std":  [1.0, 1.2, 1.2, 1.2, 1.0, 1.2, 1.5, 1.0],
    },
    "avg_female": {
        "mean": [4.0, 5.5, 5.0, 6.0, 5.0, 5.0, 5.0, 4.0],
        "std":  [1.0, 1.2, 1.2, 1.2, 1.0, 1.2, 1.5, 1.0],
    },
    "elite_male": {
        "mean": [9.0, 7.0, 5.0, 4.0, 6.5, 5.5, 6.0, 8.0],
        "std":  [0.8, 1.1, 1.2, 1.3, 1.0, 1.2, 1.5, 0.9],
    },
    "elite_female": {
        "mean": [9.0, 7.0, 5.0, 5.0, 7.0, 5.0, 5.5, 8.0],
        "std":  [0.8, 1.1, 1.2, 1.3, 1.0, 1.2, 1.5, 0.9],
    },
}


def sample_cohort_wheel_scores(name: str, n_days: int = 200, seed: int = 42) -> pd.DataFrame:
    """N synthetic per-day 8-dim wheel-score vectors for one cohort.

    Values are clamped to [0, 10] to match the wheel-score contract used by
    the heal-daily-pages consumer (`writer.WheelScores`).
    """
    rng = np.random.default_rng(seed + abs(hash((name, "wheel"))) % 10000)
    prior = COHORT_WHEEL_PRIORS[name]
    raw = rng.normal(loc=prior["mean"], scale=prior["std"], size=(n_days, len(WHEEL_DIMENSIONS)))
    raw = np.clip(raw, 0.0, 10.0)
    df = pd.DataFrame(raw, columns=WHEEL_DIMENSIONS)
    df["cohort"] = name
    return df


def build_cohort_wheel_corpus(n_days_per_cohort: int = 200, seed: int = 42) -> pd.DataFrame:
    """Stack all cohorts' wheel-score matrices for UMAP fitting in wheel-space."""
    return pd.concat(
        [sample_cohort_wheel_scores(name, n_days_per_cohort, seed) for name in COHORT_NAMES],
        ignore_index=True,
    )
