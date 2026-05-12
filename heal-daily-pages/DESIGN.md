# HEAL Daily Pages — design decisions

This document explains the *why* behind each phase of the build. Code under `src/heal_pages/` explains the *what*. If a decision is reversed, update this file in the same change. V0 decisions appear in §1–§20; V1 decisions appear after them in a dedicated section.

## Goal

Produce one row per `(user, UTC date)` supporting three retrieval modes — **behavioral similarity** (vectors), **semantic similarity** (text embeddings), **lexical search** (BM25 / FTS) — across four data sources: wearables, financial, email, messages. v3 of the spec adds **trajectory features**, **time-stamped centroids**, and an **interventions** table with urgency and outcome tracking.

This repo is the **infrastructure-only V0 ship**: schema migration, redaction harness, source-adapter boundary, fixture adapter, writer plumbing. No extractors, no embeddings, no LLM calls, no trajectory, no intervention generation. Each later phase lights up one source or one capability behind the seams V0 establishes.

This is a **separate hackathon project from heal-api**. The integration seam is the `SourceAdapter` Protocol + the `current_user()` function — both are stub implementations in V0, both are designed for one-file replacement when heal-api is connected.

## Run

```bash
# Local with uv
uv sync
docker compose up -d postgres
uv run alembic upgrade head
uv run pytest

# Or full Docker
docker compose up -d
docker compose exec app heal-pages
```

---

## 1. Standalone repo, future-connectable to heal-api

**Decision.** Lives outside heal-api. Two integration seams: `SourceAdapter` Protocol and `current_user()`. Nothing else in this codebase imports from heal-api.

**Rejected.**
- *Inside heal-api as a module.* Couples experimental work to a production codebase; can't iterate independently.
- *Hard fork that copies heal-api types.* Forces sync drift the moment either side changes.

**Implications.** When heal-api integration time comes, add `src/heal_pages/sources/heal_api.py` implementing the Protocol; replace `identity.current_user()` body with JWT validation; decide DB topology (recommend separate). That's the entire integration surface.

---

## 2. CLI / offline pipeline pattern, hosted LLM for V2+

**Decision.** Same shape as the `pipeline/` repo: console script (`heal-pages`), Docker (multi-stage with uv), Postgres + pgvector via docker-compose. LLM calls (V2+) go to **hosted providers** (OpenAI / Anthropic) over redacted text.

**Why hosted.** Cost is bounded at hackathon scale. Privacy story is "post-redaction text only" — the redaction harness is the load-bearing safety net.

**Rejected.**
- *Self-hosted small model* — more privacy-friendly but premature infra for a hackathon.
- *LLM on raw text* — never. Redaction is mandatory before any external call.

---

## 3. All dates in UTC

**Decision.** `daily_pages.date` and all timestamps are UTC. No user-local conversion in V0 or beyond.

**Why.** Plaid is UTC, Garmin is user-local, iMessage is device-local — picking any single zone introduces split-day events. UTC is the simplest answer that's wrong for nobody, and the user-local conversion can be done at *display* time without touching the storage layer. Documented trade-off: a workout that ends at 11pm PT becomes "the next day" in UTC.

**Rejected.**
- *User home timezone* — needs a stable `user.timezone` field and breaks on travel days.
- *Floating per-source local* — extractors can't agree on which date a 11pm event belongs to.

---

## 4. Backfill: forward-only + 30-day on-demand

**Decision.** From system start, every day flows through forward-only. On user onboarding (or explicit request), run a one-shot **30-day backfill** of historical data per user.

**Why.** A multi-year backfill is multi-source-asymmetric (Plaid 24mo, Gmail unbounded, iMessage one-shot device export), high-cost, and a peak-load event. 30 days is enough to demo similarity / topology / trajectory features without crossing into the pain.

**Implication.** Backfills run **chronologically per user** (trajectory in V3 depends on prior days). Resumability via `backfill_progress` is in the schema from V0.

**Rejected.**
- *Multi-year backfill at launch* — costs and load are out of proportion for a hackathon.
- *No backfill at all* — demo path becomes "wait 7 days for trajectory to warm up."

---

## 5. Wheel-score aggregation: defer-and-weighted-mean hybrid

**Decision.** Each extractor emits per-extractor `wheel_contributions: {dimension: value}`. Stored verbatim in `metadata.wheel_contributions`. The top-level `metadata.wheel_scores` is a **weighted mean** computed from those contributions using the table in `config.WHEEL_WEIGHTS`. Weights are versioned via `wheel_weights_version`.

**Why.** Locking the contract early means every extractor in V1+ knows exactly what to emit. Weighted mean keeps dimensions comparable. Storing raw contributions means weights can be re-tuned without re-running extractors.

**Rejected.**
- *Sum of contributions* — dimensions touched by more extractors structurally outscore others.
- *Max* — discards cumulative signal.
- *Confidence-weighted aggregation* — adds a confidence field to every extractor's output; over-engineered for V0.
- *Defer entirely (no top-level)* — every UI consumer reinvents the math.

---

## 6. Top-wellness-day scoring: weighted sum of wheel_scores

**Decision.** When V3 picks "top quartile wellness days" for the `target_personal_best` centroid, it scores a day as the **weighted sum** of `wheel_scores` using `config.TOP_WELLNESS_WEIGHTS`.

**Why.** Single scalar per day → easy quartile boundary. Weights are tunable per-deployment (some products care more about physical, others more about social).

---

## 7. Identity: hardcoded user_id from config

**Decision.** `identity.current_user()` returns `config.USER_ID` (defaulting to a stable test UUID, override via `HEAL_PAGES_USER_ID`). No auth, no users table.

**Why.** Hackathon. Auth is V-future. Single seam means swapping in heal-api JWT validation is one file's worth of change.

---

## 8. Feature vector layout: split base/trajectory columns, NOT a single 300d concat

**Decision.** `daily_pages.base_features VECTOR(240)` + `daily_pages.trajectory_features VECTOR(60)` — two separate columns with separate HNSW indexes.

**Why.** Three reasons:
1. **pgvector dim changes are expensive** (column rebuild + re-embed + re-index). Split columns let each grow independently — adding a fifth source bumps base; adding a regime detector bumps trajectory.
2. **Semantic distinction is real.** Base features describe "this day"; trajectory features describe "shape of recent days seen from this day." Mixing them in cosine space treats them as commensurable, which they aren't.
3. **Most queries want one or the other.** "Days like today" queries base; "trajectories like this user's" queries trajectory; "behavioral similarity" can join both client-side with explicit weighting.

**Rejected.**
- *Single 300d concat (per the spec)* — couples extractors, requires re-embed on extractor changes, mixes incommensurable signal.
- *Padded 384d / 512d for future-proofing* — index size grows; cosine quality degrades with too many zero dims.

---

## 9. Centroids split to match feature columns

**Decision.** `user_centroids.base_features VECTOR(240)` + `user_centroids.trajectory_features VECTOR(60)`. Same for the centroid/delta columns on `interventions`.

**Why.** The base centroid is the user's typical day-state (stable, useful for drift queries). The trajectory centroid is the user's typical pattern of change (volatile, useful for "trajectories like this user's"). Different things — store separately.

---

## 10. Cold-start trajectory: NULL, not zero

**Decision.** Days where the rolling window isn't yet warm have `trajectory_features = NULL` and `metadata.trajectory_warm = false`. Trajectory-using queries gate on `trajectory_warm`.

**Why.** Zero-fill pollutes cosine; cohort-mean fill makes cold-start days look typical when they're undefined. NULL is honest: the signal isn't there yet.

---

## 11. Drift score: per-dimension, per-source registry

**Decision.** Drift formulas are **unique per (source, feature)**. V3 ships a registry mapping `(source_name, feature_name) → DriftFn`. The aggregated scalar `drift_magnitude` is the L2 norm of the per-dimension z-scores against the baseline centroid.

**Why.** A 5-bpm shift in resting HR is a different signal than a $50 shift in daily spend; one drift formula won't fit both. Per-dim z-scores feed `priority_score = drift_magnitude × wheel_weight × decay` cleanly because they're already normalized.

**Not implemented in V0.** Trajectory + drift land together in V3.

---

## 12. Anomaly threshold: |z| > 2.5, aggregated daily count

**Decision.** Per-feature threshold `|z| > 2.5` (not 2.0 — a `z>2` over 60 anchor features yields ~3 false positives per day by chance). Interventions never trigger on a single feature; they trigger on the **aggregated daily anomaly count** crossing a learned threshold.

**Rejected.**
- *|z| > 2 per spec* — multi-comparison false-positive disaster.
- *Bonferroni correction* — overly conservative; misses real co-drift events.

---

## 13. Intervention generation: hybrid (rules pick template, LLM personalizes)

**Decision.** Two layers:
1. **Deterministic rule layer** picks an `action_template_id` based on drift / centroid distance / wheel weights.
2. **LLM layer** (OpenAI/Anthropic, post-redaction context only) writes the user-facing `title` and `rationale` strings conditioned on the user's recent days.

The `expected_delta` lives with the template, not the LLM.

**Why.** Rules give an audit trail ("why did the system suggest this?"). LLM gives copy that doesn't feel templated. Causal model stays deterministic.

**Rejected.**
- *Pure LLM* — opaque, expensive, and the LLM doesn't have direct access to the feature distribution it would need.
- *Pure rules* — copy reads like an alarm, not a recommendation.

**Not implemented in V0.** Intervention generator lands in V4.

---

## 14. Expected-delta source: hand-curated, then empirical override

**Decision.** Each `action_template` row stores an `expected_*_delta` vector. Initially `expected_delta_source = 'curated'` (human-set). After **N=30 completed interventions** of the same template, replace with the empirical mean `observed_delta` and flip the field to `'empirical'`.

**Why.** Self-improving without bootstrap problems. Curated values are honest about being a best guess until enough data exists.

---

## 15. Recency weighting: exponential decay, 30-day default half-life

**Decision.** "Days like today, weighted by recency" computes:

```
weighted_score = cosine_similarity * exp(-Δdays / half_life)
```

with `half_life = config.RECENCY_HALF_LIFE_DAYS = 30` as the default, exposed as a query parameter.

**Why.** Single tunable parameter, smooth decay, matches user mental model (a year-old day gets ~3% weight relative to today).

---

## 16. Action catalog: Postgres table, not YAML

**Decision.** `action_templates` is a real Postgres table.

**Why.** Auditable. Empirical-override updates write directly to it. Runtime tuning without redeploys. YAML would force a deploy for every weight change.

**Rejected.**
- *YAML in repo* — fine for the first 5 templates, painful at 50+.

---

## 17. Intervention overlap: three-mode policy

**Decision.** Three distinct conflict modes, each handled separately:

1. **Hard mutex (same time slot)** → both interventions tagged with the same `exclusion_group_id`. UI shows them as a "pick one" card. No DB-level enforcement; the generator and UI cooperate.
2. **Soft conflict (negative cosine on `expected_delta`)** → resolved at write time. The generator, when about to write a new intervention, checks active interventions with `cosine(expected_delta_new, expected_delta_existing) < 0` and **drops the lower-priority candidate** before writing.
3. **Hard prerequisite** → `depends_on` is a self-FK. B stays inactive (UI doesn't surface, it can't be accepted) until A.status = 'completed'.

**Why three modes.** Single overlap policy can't cover same-time-slot exclusivity, opposite-direction conflict, and ordering dependency simultaneously.

---

## 18. Redaction: Presidio + custom recognizers + post-validator

**Decision.** Three lines of defense in `redact.py`:

1. Presidio analyzer + anonymizer over a fixed entity list (PERSON, EMAIL_ADDRESS, PHONE_NUMBER, LOCATION, CREDIT_CARD, US_BANK_NUMBER, US_SSN, IP_ADDRESS, URL, IBAN_CODE, US_DRIVER_LICENSE, US_PASSPORT). DATE_TIME deliberately excluded — health data is timestamps.
2. Custom recognizers (`recognizers/` package) — empty in V0, populated as misses surface from V4 onward.
3. Post-redaction regex validator (SSN/CC/email/phone). If anything matches the redacted text, the page goes to `daily_pages_quarantine`, NOT `daily_pages`. Manual review tunes the recognizers.

**Why three lines.** Presidio NER misses uncommon patterns; custom recognizers add domain knowledge; the validator is the cheap last-chance regex sweep that catches what NER missed before it goes to storage / LLM.

**Why DATE_TIME is excluded.** Wearable text and per-day summaries are full of legitimate timestamps. Redacting them removes core signal. Extractors must emit dates as ISO strings, not as natural-language phrases.

**Why quarantine, not auto-replace.** Silently re-redacting a missed pattern hides the recognizer gap. Quarantining surfaces it for review and tuning.

---

## 19. HNSW indexes, not IVFFlat

**Decision.** All vector indexes use `hnsw`.

**Why.** No training step (IVFFlat needs `lists ≈ sqrt(N)` and re-training after bulk loads). Better incremental insert behavior at the corpus size we'll see in V0–V3 (sub-1M rows).

---

## 20. Idempotency: per-source content hash

**Decision.** `daily_pages.data_signature` is a JSONB map `{source: sha256}`. The writer compares stored vs current; only recomputes the changed source's slice + dependent text/embedding.

**Why.** Late-arriving data (Garmin sync 3 days later, Plaid backfill) shouldn't trigger a full row recompute. Per-source hashes give surgical recompute.

---

## Out of scope for V0 (deferred, called out here)

- Any extractor (V1+).
- Embedding generation (V2+).
- LLM calls (V2+).
- Trajectory computation, centroids, drift (V3).
- Intervention generation (V4).
- UMAP projection / embedding-atlas integration (V6).
- **Column-level encryption / KMS** — production gap; hackathon DB stores `page_text` as plain TEXT.
- **Real auth** — JWT validation against heal-api auth (post-MVP).
- **Audit logging** for `daily_pages` reads (production gap).
- **Multi-language redaction** — Presidio defaults to English; non-English text has poor recall.
- **Cohort-target centroids** (`target_cohort` centroid_type) — schema reserves the type but no writer until cross-user aggregation lands.
- **Action catalog seed content** — V4 ships templates; V0 just provides the table.
- **Embeddings as PHI** — text embeddings are vulnerable to inversion attacks (Carlini et al.). V0 doesn't apply special access controls; V-future treats them with the same gates as `page_text`.
- **`page_tsv` exposure** — even when `page_text` is encrypted, the GIN index leaks tokens. Acceptable for hackathon, document for production.

## V1 decisions (extractor + consumer)

V1 lights up the wearable path end-to-end: extractor → consumer orchestrator
→ writer → lexical search. The decisions below are additive to V0; the seams
defined in §1, §2, §7, §18, §20 still hold.

### V1-1. Base-feature slot contract: equal 60d per source, permanent

**Decision.** `config.BASE_FEATURE_SLOTS` carves the 240d `base_features`
vector into four contiguous 60d slices:

```
wearable  = indices   0..59
financial = indices  60..119
email     = indices 120..179
messages  = indices 180..239
```

Slot boundaries are **permanent once shipped**. Adding a feature claims a
reserved index inside the source's slot; shifting an existing index would
require re-embedding every historical row. A fifth source bumps
`BASE_FEATURES_DIM` and adds a new slot — never reshuffles existing ones.
`BASE_FEATURE_SLOTS_VERSION` is bumped if the contract ever has to break.

**Rejected.**
- *Weighted-by-expected-complexity slots* (e.g. wearable=90, financial=60,…) —
  premature; we don't yet know which source's feature space will grow fastest.
- *Pack-as-you-go* (wearable claims 0..K, others TBD) — the boundary
  becomes a negotiation when the second source lands; better to lock it now.

**Implication.** Each extractor zero-pads its own unused slots so it always
emits a full 60-element vector. `consumer._write_slice` enforces this with
a hard `ValueError` on mismatch.

### V1-2. Extractor Protocol: one seam, one shape

**Decision.** `extractors.base.Extractor` is a `runtime_checkable` Protocol
returning an `ExtractorOutput { features, text, wheel_contributions }`.
Wheel contributions are keyed by wheel dimension name; **dimensions the
source can't speak to are OMITTED, not zero-filled**.

**Why omit ≠ zero.** The wheel aggregator is a weighted mean over present
sources for each dimension (per §5). A 0.0 contribution from a source that
genuinely has no signal would pull the mean down; absence correctly skips
that source from the dimension's weight sum.

### V1-3. Wearable feature layout (within slot 0..59)

| Indices | Block | Features |
|---|---|---|
| 0..6 | HR | resting / avg / peak / range / window count / aerobic-min (100–139 bpm) / anaerobic-min (≥140 bpm) |
| 7..14 | Sleep | deep / rem / light / awake / total / efficiency / restorative-pct / continuity |
| 15..18 | Steps | total / active-proxy (steps/100) / high-active flag (>10k) / low-active flag (<3k) |
| 19 | Composite | wellness scalar `efficiency·50 + min(steps/10k,1)·30 + max(0,180−rHR)·0.2` |
| 20..59 | Reserved | HRV, VO2, calories, training-load, etc. (`0.0` until claimed) |

Wheel contributions emitted: `physical`, `emotional`, `spiritual`,
`environmental`. The four absent dimensions (intellectual, social,
occupational, financial) are correctly never zero-filled.

### V1-4. Page-text scope: wearable only in V1

**Decision.** `daily_pages.page_text` contains only the wearable extractor's
narrative in V1. Financial / email / messages produce no text until their
respective extractor phases (V4–V6).

**Why.** Templated counts for sources without an extractor add lexical noise
without signal — "1 charge" tokenizes but matches nothing meaningful. The
matter of cross-source narrative belongs in V2 (LLM-written summaries), not
V1's deterministic stub.

**Implication.** V1 lexical search hits HR / sleep / steps vocabulary only
("restorative sleep", "high-activity day", "fragmented sleep"). The
extractor emits stable narrative phrases — qualitative anchors give
`tsvector` something more useful than bare numbers.

### V1-5. Consumer / orchestrator boundary

**Decision.** `consumer.process_day(session, user_id, day, adapters,
extractors)` is the only place that knows about all sources at once.
Adapters and extractors are passed in as `dict[SourceName, …]` so the same
function works for V1 (wearable extractor only) through V6 (all four).

**Idempotency** runs through `daily_pages.data_signature`: the consumer
collects per-source signatures from adapters, compares to the stored map,
and short-circuits to `outcome="skipped"` when they match (unless `force=True`).
This also means sources with an adapter but no extractor still contribute
their signature → late-arriving extractors will trigger a recompute when
their source's signature has changed since the last write.

### V1-6. Backfill resume policy: min(per-source last_completed) + 1

**Decision.** `backfill.run_backfill()` walks dates ascending in
`[today − days + 1, today]`. The resume point is
`max(target_start, min(last_completed_date + 1 across sources with progress))`.

**Why `min` across sources, not `max`.** The consumer processes every source
at every date in one pass (writer is idempotent). Taking the **min** ensures
no date is skipped if a source lags. Taking the max would skip dates the
lagging source hasn't yet covered.

**Failure handling.** Any exception during the walk rolls back the current
day's transaction, marks **every** source's `backfill_progress` row as
`status='failed'` with the error string, and re-raises. A clean run marks
each source `completed`.

### V1-7. Lexical retrieval API: `search_pages`

**Decision.** `search.search_pages(session, user_id, query, limit)` is the
sole lexical-mode entry point in V1. Uses `websearch_to_tsquery('english',
query)` so users can pass phrases / negation without the caller escaping
anything. Hits are returned ordered by `ts_rank` descending.

Semantic (`text_embed` cosine) and behavioral (`base_features` cosine)
modes land in V2 and V3 respectively. A unified `retrieve.py` facade comes
later; V1 stays small on purpose.

### V1-8. Skipped: derived/per-record features and trajectory

Trajectory features and per-feature drift remain V3 work. V1 fills
`trajectory_features=NULL` and `metadata.trajectory_warm=false` (the V0
default), so trajectory-using queries correctly gate themselves out.

---

## Phasing reference

```
V0  schema, redaction, source-adapter protocol, fixture adapter, writer, identity stub.

V1  ◄── current
    wearable extractor (lowest PII), base feature writes, lexical mode end-to-end,
    30-day on-demand backfill (chronological, resumable via backfill_progress).

V2  text embedding adapter (semantic mode), hosted LLM (OpenAI/Anthropic) for
    wearable summaries, centroid computation nightly job (current_7d, current_30d).

V3  trajectory features (deltas, rolling, trend, regime markers),
    per-dimension/per-source drift formulas (registry pattern),
    "days like today" + 30-day-half-life recency weighting,
    aggregated daily anomaly count.

V4  financial extractor (first heavy-PII source),
    intervention generator (rules pick template, LLM personalizes copy),
    hand-curated action_templates seeded,
    overlap resolution (exclusion_group_id mutex, neg-cosine drop, depends_on chain).

V5  email extractor.

V6  messages extractor, empirical expected_delta override (after N=30 completions),
    UMAP projection job → embedding-atlas integration.
```

## How to extend

| Want to… | Touch |
|---|---|
| Add a custom Presidio recognizer | `src/heal_pages/recognizers/` (new module) + register in `__init__.CUSTOM_RECOGNIZERS` + add OperatorConfig in `redact.py` + add adversarial test in `tests/test_redact.py` |
| Add a post-validator pattern | `redact.py:VALIDATOR_PATTERNS` + add test case in `tests/test_redact_validator.py` |
| Implement a heal-api source adapter | `src/heal_pages/sources/heal_api.py` implementing `SourceAdapter` Protocol — single file |
| Swap identity to JWT validation | `src/heal_pages/identity.py` — single function |
| Tune wheel weights | `src/heal_pages/config.py:WHEEL_WEIGHTS` + bump `WHEEL_WEIGHTS_VERSION` |
| Add a wheel dimension | `config.WHEEL_WEIGHTS` (new row) + `writer.WheelScores` (new field) — also requires migration of existing rows |
| Add a wearable feature | Claim a reserved index in `extractors/wearable.py` (slots 20..59) + extend `_render_text` only if it carries lexical signal + add test in `tests/test_wearable_extractor.py` |
| Land a new source's extractor (V4+) | `extractors/<source>.py` implementing the Protocol + slot-sized output + register in `extractors/__init__.py` + pass it to `process_day` via the CLI |
| Add a retrieval mode (V2+ semantic / V3+ behavioral) | New module alongside `search.py`; do **not** repurpose `search_pages` — keep the lexical surface stable |
