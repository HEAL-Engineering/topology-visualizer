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
#
# Sourced from published Garmin / Apple Health / sports-science data
# (May 2026 scrape). Provenance documented in pipeline/DESIGN.md §4.
#   avg_male/avg_female:
#     - resting_hr   Apple Heart & Movement Study (n=207,609, 2021-2025)
#                    age-30-49 peak: M 66, F 68.9
#     - peak_hr      Allison et al. ACC 2014 observed peaks
#                    M 166±17, F 163±16
#     - sleep_*      Garmin 2024 sleep report (mean adult user)
#                    M total 7h29m (deep 67 / REM 82 / light 275 / awake 24)
#                    F total 7h50m (deep 71 / REM 92 / light 292 / awake 24)
#     - steps        Bassett et al. 2010 US adults
#                    M 5,340 / F 4,912 steps/day
#   elite_male/elite_female:
#     - resting_hr   Topend Sports elite-RHR ranges (cyclists/marathoners)
#                    M 35-45, F 40-50; midpoints used
#     - sleep_*      Sports-medicine consensus (PMC4008810, runbikecalc 2026):
#                    target 9h, observed <8h; deep+REM elevated for recovery
#     - steps        Sub-elite endurance training volume (~100-150 km/wk)
#                    yields 13-15k steps/day
COHORT_PRIORS: dict[str, dict[str, list[float]]] = {
    "avg_male": {
        "mean": [66, 80, 165,  67,  82, 275, 24, 449,  5340],
        "std":  [ 8,  9,  17,  14,  18,  35,  8,  55,  1800],
    },
    "avg_female": {
        "mean": [68, 83, 163,  71,  92, 292, 24, 470,  4912],
        "std":  [ 9, 10,  16,  15,  20,  38,  9,  55,  1700],
    },
    "elite_male": {
        "mean": [40, 70, 190,  95, 130, 280, 15, 520, 15000],
        "std":  [ 5,  8,  12,  18,  22,  32,  6,  40,  3500],
    },
    "elite_female": {
        "mean": [44, 72, 188, 100, 130, 280, 15, 525, 14000],
        "std":  [ 5,  9,  12,  20,  22,  32,  6,  40,  3300],
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
