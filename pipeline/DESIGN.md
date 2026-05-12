# Design decisions — wellness atlas pipeline

This document explains the *why* behind the pipeline. The code under `heal_atlas/` (`cohorts.py`, `featurize.py`, `reduce.py`) explains the *what* and *how*. If a decision below is reversed, update this file in the same change.

## Goal

Take a heal-api dedup JSON dump (the user's `dedup_heart_rates`, `dedup_sleep_sessions`, `dedup_daily_steps`) and produce a 3D atlas where the user's daily wellness state is plotted alongside four reference cohorts: average American adult (male/female) and elite endurance athlete (male/female). Output is canonical `AtlasDataset` JSON, consumed by the existing embedding-atlas drag-and-drop UI.

## Run

```
# Local (uv):
cd pipeline && uv sync
uv run heal-atlas sample_input.json atlas.json

# Docker (platform-agnostic, no local Python needed):
docker build -t heal-atlas-pipeline pipeline/
docker run --rm -v "$PWD/pipeline:/data" heal-atlas-pipeline /data/sample_input.json /data/atlas.json
```

Then drop `atlas.json` into the embedding-atlas DataLoader.

---

## 1. CLI / offline, not a hosted service

**Decision.** Ship as a console script `heal-atlas <in.json> <out.json>`, exposed both via the local `uv run` and the Docker entrypoint. The user runs it locally and drops the produced JSON into the existing `DataLoader` UI.

**Rejected alternatives.**
- *Hosted backend (FastAPI + endpoint)* — adds deployment, auth, and a PHI surface for an MVP that does not yet need them.
- *Pyodide in-browser* — bundle weight (15–30 MB) and brittle UMAP-learn behavior under WebAssembly; not MVP-friendly.

**Implications.** Health data never leaves the user's machine. The visualizer remains a static SPA. When a hosted variant is needed later, the same `reduce.run()` function can be wrapped behind an HTTP endpoint without rewriting featurization.

---

## 2. Co-projection: fit on cohorts, transform user

**Decision.** UMAP is fit ONCE per run on the cohort corpus, then user days are projected via `reducer.transform()` into that fixed space.

**Rejected alternatives.**
- *Fit on the union (cohorts ∪ user)* — every upload yields a new cohort topology, making "where am I relative to elite athletes?" non-comparable across sessions. The cohort must be the stable map, not a co-mover.
- *Persist the fitted reducer to disk* — useful later, but premature when the cohort corpus is small (~800 rows) and re-fits in under a second.

**Trade-off.** Only features present in the cohort schema can be projected. Adding a new biomarker requires updating `cohorts.FEATURES` and the cohort priors in lockstep.

---

## 3. Granularity: one point per (user, date)

**Decision.** The unit of analysis is a user-day vector — one row per day of activity.

**Rejected alternatives.**
- *Per-record* (each HR window or sleep session) — too noisy for cohort comparison and not how the cohort priors are framed.
- *Per-user-aggregate* (mean over all days) — erases the topology we want to show: rest day vs hard-training day vs poor-sleep night.

A "day" is the smallest unit at which sleep / steps / heart rate resolve into a coherent state.

---

## 4. Cohorts are synthetic Gaussian samples from literature priors

**Decision.** Four reference cohorts (`avg_male`, `avg_female`, `elite_male`, `elite_female`) are sampled from per-feature Gaussian priors hardcoded in `cohorts.py`. Default size: 200 days × 4 cohorts = 800-row training corpus.

**Rejected alternatives.**
- *Real anonymized data* — not available for MVP.
- *Public dataset (NHANES, MESA, UK Biobank)* — schema mismatch with the dedup tables, plus licensing / ETL overhead inappropriate for an MVP.

The priors encode the *direction* of cohort separation (low resting HR and high steps for elites, etc.) without claiming demographic accuracy. **Replace before any clinical or comparative claim is made.**

---

## 5. Imputation: cohort-mean for missing features

**Decision.** When a user-day has NaN for a feature (e.g. no HR logged), substitute the cohort *unscaled* mean before standardization.

**Why.** A day with sparse logging shouldn't separate the user purely on *what they didn't log*. Imputing with the cohort mean lands the day near the cohort centroid — honest about the lack of signal rather than inventing one.

**Rejected alternatives.**
- *Drop incomplete days* — most user uploads will have at least one feature missing on at least one day; this would hide most of the user's data.
- *Per-feature user mean* — collapses the user toward their own centroid, removing the day-to-day variation that is the whole point of the visualization.

---

## 6. Standardization: shared scaler fit on cohorts

**Decision.** A single `StandardScaler` is fit on the cohort matrix; both cohort and user vectors are transformed with it before UMAP.

**Why.** UMAP's distance metric needs features on a comparable scale (steps ranges in thousands; resting HR in tens). Fitting the scaler on cohorts only — not the union — keeps the user out of the scaler's parameters, so two users with very different ranges still land in the same coordinate system.

---

## 7. Mapper edges: pre-defined cohort topology + dynamic user link

**Decision.** The cohort overlay is hardcoded — `avg ↔ elite` within each sex, `avg ↔ avg`, `elite ↔ elite`. The user is connected to the nearest cohort centroid in projected 3D space.

**Why.** The cohort topology is known a priori (literature-derived spectrum: average → elite, male / female), so deriving edges from data would be circular. The user → nearest edge is the visual anchor for the "where do I sit?" story.

---

## 8. Determinism: `random_state=42` everywhere; no on-disk cache

**Decision.** Every run is reproducible: re-running on the same input yields byte-identical output. No model files persist on disk in the MVP — the cohort corpus and reducer are rebuilt each run (sub-second on this corpus size).

**When to revisit.** Once the cohort corpus exceeds ~10k rows or the fit becomes slow, wrap `fit_reference()` with `joblib.dump` / `joblib.load` keyed on a hash of `(COHORT_PRIORS, n_days, seed)`.

---

## 9. Dependency management: `uv` with `pyproject.toml` (no requirements.txt)

**Decision.** Dependencies and the console-script entrypoint are declared in `pyproject.toml`. `uv sync` resolves and installs into a project-local `.venv`. `uv.lock` (committed once generated) gives byte-deterministic installs.

**Rejected alternatives.**
- *pip + requirements.txt* — no lockfile semantics, slow resolves, no built-in script entrypoint registration.
- *Poetry* — heavier, slower, redundant with uv's feature set.

**Why this matters here.** `umap-learn` pulls in `numba` and `llvmlite`, which have heavy native deps and slow resolves under pip. uv's resolver is an order of magnitude faster and produces reproducible installs across the host and the Docker builder.

---

## 10. Containerized runtime: multi-stage Docker with the official `astral-sh/uv` image

**Decision.** Two-stage Dockerfile. Build stage uses `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` for `uv sync`; runtime stage is plain `python:3.12-slim-bookworm` with the resolved `.venv` copied across. Entrypoint is the `heal-atlas` console script.

**Why split stages.** uv and build tools are not needed at runtime. Splitting drops ~150 MB from the shipping image and keeps the runtime surface minimal.

**Why `bookworm-slim` over `alpine`.** `numba` / `llvmlite` distribute prebuilt wheels for `manylinux` (glibc) but not `musllinux` reliably. Alpine would force a from-source compile of LLVM-related deps — fragile and slow. Debian slim is the cheapest path to working multi-arch wheels.

**Platform agnosticism.** The build is multi-arch ready: `docker buildx build --platform linux/amd64,linux/arm64 ...` produces images that run on Apple Silicon, Intel/AMD Linux, and ARM cloud instances without source changes. Wheels for numpy/pandas/scikit-learn/umap-learn/numba are published for both arches.

**Rejected alternatives.**
- *Single-stage build* — leaves uv + build tooling in the runtime image (~150 MB overhead).
- *Distroless runtime* — saves ~30 MB but breaks debugging (`docker run --rm -it ... bash`) for an MVP where iterability matters more than image weight.
- *`pip install` inside the Dockerfile* — slower resolves, no lockfile parity with the host install.

**Implications.** The CLI takes paths; users mount a host directory at `/data` and pass `/data/...` paths. Health data stays on the host disk; the container is stateless.

---

## Out of scope (documented, not implemented)

- Real (non-synthetic) cohort distributions.
- Sex/age/BMI conditioning of cohort priors (currently sex-only).
- Per-record (sub-day) granularity.
- Privacy / PHI handling beyond "data stays on disk".
- Hosted-service variant (separate plan when needed).
- Persistent / cached fitted reducer.
- Time-aware features: rolling windows, weekly patterns, training-load deltas.
- Multi-user comparison (atlas currently shows one user at a time vs cohorts).

---

## How to extend

| Want to… | Touch this |
|---|---|
| Add a biomarker (e.g. HRV) | `heal_atlas.cohorts.FEATURES` + `COHORT_PRIORS` + `heal_atlas.featurize.featurize_user` (compute from raw rows) |
| Add a cohort (e.g. `recovering_athlete`) | `heal_atlas.cohorts.COHORT_NAMES` + `COHORT_PRIORS` + `heal_atlas.reduce.CATEGORY_COLORS` + (optionally) `to_atlas_dataset` mapper edges |
| Replace synthetic cohorts with real data | Implement a new builder returning the same schema as `build_cohort_corpus`; swap in `fit_reference` |
| Persist the fitted reducer | Wrap `fit_reference` with `joblib.dump` / `joblib.load`, key by `(priors, seed)` hash |
| Change projection algorithm | Swap `umap.UMAP` in `fit_reference`. Output `meta.projection` should track the algorithm name. |
| Pin a dep / add a new one | Edit `pyproject.toml`, run `uv lock` to refresh `uv.lock`, rebuild image |
