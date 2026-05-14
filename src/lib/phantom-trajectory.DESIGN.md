# Phantom Trajectory — Design Decisions

The phantom trajectory renders a synthetic "could-be" point cluster sitting near a chosen elite cohort, plus a metric-composition list of feature deltas the projection assumes. This doc captures the non-obvious choices behind that pairing.

## The two-surface model

The phantom answers two questions the user actually asks:

1. **Where would I land?** — a 3D ghost cluster with its own PCA-fit shape, dashed arrow from user centroid → phantom centroid.
2. **What does landing there require?** — a ranked list of feature deltas (resting HR, deep sleep, REM, steps, ...) with prescriptive sentences.

Surface 1 (geometry) without Surface 2 (composition) was the original behavior. Users could increase steps tenfold and notice the user cluster didn't move toward elite — because steps alone isn't what produced the elite cluster's position. The composition list is the guardrail that makes the projection legible.

## Why composition is computed in feature space, not UMAP space

The geometric move (user centroid → phantom centroid) lives in UMAP coordinates. The honest source of "what features differ" is the feature space the embedding was computed from.

These are correlated — UMAP placed the cohorts apart precisely *because* these features differ — but feature-space ranking is not numerically identical to per-feature UMAP-axis contribution. Estimating the latter would require:

- Re-running the projection with held-out features to attribute axis variance (expensive, requires the embedding model)
- OR local PCA on the cohort and decomposing the move along principal axes (cheaper, still adds dependency)

Both are out of scope for an inline guardrail. We pick the simpler, defensible approximation and label the UI copy carefully:

> "What this projection assumes you change"

not

> "What produces this shape"

The first is true by construction (composition = means of the cohort being targeted). The second is a stronger claim we can't back without the attribution work above.

## Cohort means at runtime, not hardcoded priors

`lobe-actions.ts` has a `MetricInfo.eliteTarget` value per metric — these mirror `pipeline/heal_atlas/cohorts.py` COHORT_PRIORS for `elite_male`. They're fine for per-lobe action items where the morph destination is fixed to elite-male.

For phantom composition we use the *actual cohort cluster mean* per metric (`computeLobeStats(targetPts)`):

- The phantom supports both `elite_male` and `elite_female` targets. Hardcoded elite_male targets would mis-state the gap for an elite_female projection (resting HR, peak HR, sleep totals all differ between cohorts).
- The geometric arrow already uses the actual cohort points. The composition table must agree with the arrow, not with a separate prior.
- When the dataset is regenerated with new cohort distributions, the composition tracks automatically — no constants to bump.

Prescriptive sentences (`doIncrease`/`doDecrease`) stay sourced from `METRICS` because those are domain advice, not numbers. A "drop resting HR with zone-2" sentence is true regardless of whether the target value is 45 or 47.

## Ranking by relative gap, not absolute gap

`steps` is in units of ~10⁴; `sleep_deep_min` is in units of ~10²; `resting_hr` is ~10¹. Sorting by absolute gap always foregrounds steps and buries everything else. Relative gap (`|delta| / |target|`) normalizes the units and gives the user a calibrated "which gap is biggest, *for that metric*."

This is the same heuristic `generateLobeActions` uses — keeping the two surfaces (per-lobe advice, phantom composition) ranked the same way means a user reading both doesn't see contradictory priorities.

## Top-N truncation

Default `compositionLimit = 5`. Beyond the top few, ranks are noisy:

- We only track 6 metrics. Showing all 6 is fine on a wide panel but past entry 5 the relative gaps are small and dominated by sample-mean noise in user / cohort points.
- More rows push the geometric summary above the fold and bury it. The visual is the headline; composition substantiates.

## Baseline scope: non-injected user points only

`userPts` filters out `meta.injected === true`. Injected points are themselves recorded "training" actions — already a step toward elite. Including them in the baseline:

- Double-counts the progress the user has already made
- Pulls the user centroid (and therefore the projection start) toward elite
- Eventually pushes the phantom *past* the elite cluster after enough injections

Filtering them keeps the projection anchored to "what the user actually is, pre-intervention" — which is what the *could-be* framing requires.

## Caveats called out for future contributors

- The composition list is correct only when point `meta` carries the heal-api feature fields. Synthetic/demo datasets without them will show a shorter list (we skip metrics with null means). That's the intended graceful degradation.
- The composition does *not* explain *jitter* in the phantom shape — that's purely geometric noise to make the cluster look lived-in. Don't try to attribute jitter back to feature-space.
- If a third cohort target is added (e.g. `elite_neutral`), no code change is needed — `computeLobeStats(targetPts)` will derive its means at runtime. Update only `PhantomTargetId` and `PRECOMPUTE_TARGETS`.
