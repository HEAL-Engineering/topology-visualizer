"""Centralized configuration for the V0 scaffold.

All knobs that future phases will tune live here so extractors / writers /
intervention generators don't reach into env vars individually. Loads from
environment with sensible defaults; nothing here is secret in V0.
"""

from __future__ import annotations

import os
from uuid import UUID

# ────────────────────────── Identity (V0 stub) ─────────────────────────────
# Hardcoded user_id from env (or default). The identity.current_user() helper
# returns this for MVP; in production this will be replaced by JWT validation
# against heal-api auth.
USER_ID: UUID = UUID(
    os.environ.get("HEAL_PAGES_USER_ID", "00000000-0000-0000-0000-000000000007")
)

# ─────────────────────────── Database ──────────────────────────────────────
DATABASE_URL: str = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://heal:heal@localhost:5432/heal_pages",
)

# ─────────────────────────── Feature dimensions ─────────────────────────────
# Locked at V0; changing these is a schema break.
BASE_FEATURES_DIM = 240
TRAJECTORY_FEATURES_DIM = 60
TEXT_EMBED_DIM = 768

# ─────────────────────────── Base-feature slot contract (V1) ────────────────
# Each source extractor owns a contiguous slice of `daily_pages.base_features`.
# Equal 60d per source — slot boundaries are a PERMANENT contract: extractors
# must emit a vector exactly `end - start` floats long, in the slot defined here.
# The consumer assembles the full 240d vector by writing each extractor's
# output into its slice.
#
# To add a fifth source: bump BASE_FEATURES_DIM, add a new slot, run a
# migration. Do NOT shift existing slots — that re-embeds every historical row.
BASE_FEATURE_SLOTS: dict[str, tuple[int, int]] = {
    "wearable":  (0,   60),
    "financial": (60,  120),
    "email":     (120, 180),
    "messages":  (180, 240),
}
BASE_FEATURE_SLOTS_VERSION = 1

# ─────────────────────────── Wheel score weights ────────────────────────────
# Per-extractor contribution weights for computing the top-level wheel_scores.
# Each row is a dimension; each column is the weight for that source's
# contribution to that dimension. Tuned heuristically for V0.
#
# wheel_scores[dim] = sum(contribution[src][dim] * WHEEL_WEIGHTS[dim][src]) /
#                     sum(WHEEL_WEIGHTS[dim][src] for src in present_sources)
WHEEL_WEIGHTS: dict[str, dict[str, float]] = {
    "physical":      {"wearable": 1.0, "financial": 0.0, "email": 0.0, "messages": 0.0},
    "emotional":     {"wearable": 0.6, "financial": 0.2, "email": 0.1, "messages": 0.5},
    "intellectual":  {"wearable": 0.0, "financial": 0.0, "email": 0.7, "messages": 0.3},
    "social":        {"wearable": 0.0, "financial": 0.0, "email": 0.4, "messages": 1.0},
    "spiritual":     {"wearable": 0.2, "financial": 0.0, "email": 0.0, "messages": 0.3},
    "occupational":  {"wearable": 0.0, "financial": 0.4, "email": 1.0, "messages": 0.1},
    "financial":     {"wearable": 0.0, "financial": 1.0, "email": 0.0, "messages": 0.1},
    "environmental": {"wearable": 0.3, "financial": 0.0, "email": 0.0, "messages": 0.0},
}
WHEEL_WEIGHTS_VERSION = 1

# Weights for computing a "wellness day" scalar from wheel_scores.
# Used by V3+ to pick top-quartile days for target_personal_best centroids.
TOP_WELLNESS_WEIGHTS: dict[str, float] = {
    "physical":      1.0,
    "emotional":     1.2,
    "intellectual":  0.8,
    "social":        0.8,
    "spiritual":     0.6,
    "occupational":  0.8,
    "financial":     0.6,
    "environmental": 0.4,
}

# ─────────────────────────── Retrieval ──────────────────────────────────────
# Exponential-decay half-life for "days like today, weighted by recency".
# A query parameter — default surfaced here.
RECENCY_HALF_LIFE_DAYS = 30

# ─────────────────────────── Backfill ──────────────────────────────────────
ON_DEMAND_BACKFILL_DAYS = 30

# ─────────────────────────── Trajectory / drift ─────────────────────────────
# Z-score threshold for flagging per-feature anomalies. Aggregated to a
# daily anomaly count; interventions never trigger on a single feature.
ANOMALY_Z_THRESHOLD = 2.5

# ─────────────────────────── Versions ───────────────────────────────────────
TEMPLATE_VERSION = "v3"
