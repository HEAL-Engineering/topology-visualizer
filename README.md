# embedding-atlas

Interactive 3D visualization for wellness-embedding data. The app projects daily wearable signals (heart rate, sleep stages, steps) into a 3D space alongside four reference cohorts (average / elite × male / female) so a user can see *where their day sits* relative to known populations.

Built around a Python pipeline (`heal-atlas`) that turns a raw heal-api dedup JSON dump into a canonical `AtlasDataset` the React/Three.js front-end renders. The renderer is generic — any 3D point cloud with categorical labels works — but the bundled pipeline is wellness-specific.

---

## 1. What you actually run

| Layer        | Stack                            | What it does                                                                 |
|--------------|----------------------------------|------------------------------------------------------------------------------|
| Front-end    | Vite + React + Three.js + Zustand | Renders `public/atlas.json` as a 3D atlas with hulls, cohort shapes, lens, table |
| Pipeline     | Python 3.12 + UMAP + scikit-learn | Reads raw dedup JSON → fits UMAP on cohorts → projects user days → writes atlas JSON |
| Augment      | Node                             | Re-attaches the 6 MetricLens biomarkers (calories, VO₂max, HRV, …) onto every point |
| Optional DB  | Postgres + alembic               | `heal-daily-pages` ingestion path (used for production data, not for trying the app) |

The two artifacts the front-end consumes:

- `public/atlas.json` — the `AtlasDataset` (points + categories + meta) the 3D scene reads
- `public/raw.json`   — the raw dedup records the Raw table panel reads, with `atlas_point_id` cross-links

---

## 2. First-time setup

### Prerequisites

- **Node ≥ 20** with `pnpm` (`npm i -g pnpm`)
- **Python 3.12** with [`uv`](https://docs.astral.sh/uv/) (`brew install uv` or `pipx install uv`)
- **Task** runner (`brew install go-task` on macOS)
- *(Optional, only for the Postgres path)* Docker Desktop

### Install

```bash
git clone <this repo>
cd embedding-atlas
task install          # pnpm install + uv sync in pipeline/ and heal-daily-pages/
```

### Boot the app on the bundled demo data

```bash
task dev              # http://localhost:5173
```

You should see four cohort clusters (blue, pink, green, gold) and a red user cluster. If the screen is empty, `public/atlas.json` is missing — jump to **§4. Regenerate the demo data**.

---

## 3. Visualize your own wellness data

This is the path most first-time users want: you have a JSON dump of dedup wearable records and you want to see where your days sit relative to the cohorts.

### 3a. Format your input JSON

The pipeline reads exactly this shape (matches the `heal-api` `dedup_*` SQLAlchemy tables). Save it as `pipeline/my_input.json`:

```json
{
  "user_id": 7,
  "dedup_heart_rates": [
    {
      "user_id": 7,
      "source": "apple_health",
      "max_bpm": 71,
      "min_bpm": 54,
      "avg_bpm": 62.4,
      "start_time": "2024-05-01T08:00:00Z",
      "end_time":   "2024-05-01T09:00:00Z"
    }
  ],
  "dedup_sleep_sessions": [
    { "user_id": 7, "date": "2024-05-01", "stage_type": 1, "duration_minutes": 212, "source": "oura" },
    { "user_id": 7, "date": "2024-05-01", "stage_type": 2, "duration_minutes": 84,  "source": "oura" },
    { "user_id": 7, "date": "2024-05-01", "stage_type": 3, "duration_minutes": 96,  "source": "oura" },
    { "user_id": 7, "date": "2024-05-01", "stage_type": 4, "duration_minutes": 18,  "source": "oura" }
  ],
  "dedup_daily_steps": [
    { "user_id": 7, "date": "2024-05-01", "steps": 11240, "source": "fitbit" }
  ]
}
```

#### Field requirements (must match exactly)

**`dedup_heart_rates[]`** — one row per HR aggregation window:

| Field        | Type   | Notes                                                            |
|--------------|--------|------------------------------------------------------------------|
| `user_id`    | int    | Must equal top-level `user_id`                                   |
| `source`     | string | Device origin (`apple_health`, `fitbit`, `oura`, …)              |
| `max_bpm`    | number | Window peak — used to compute daily `peak_hr`                    |
| `min_bpm`    | number | Window trough — used to compute daily `resting_hr` (daily min)   |
| `avg_bpm`    | number | Window mean — used to compute daily `avg_hr`                     |
| `start_time` | ISO 8601 string | First 10 chars (`YYYY-MM-DD`) become the day key          |
| `end_time`   | ISO 8601 string | Optional for the pipeline, but include for table provenance |

**`dedup_sleep_sessions[]`** — one row per sleep stage segment:

| Field              | Type   | Notes                                                  |
|--------------------|--------|--------------------------------------------------------|
| `user_id`          | int    |                                                        |
| `date`             | string | `YYYY-MM-DD` — the night this segment belongs to       |
| `stage_type`       | int    | **1=light, 2=deep, 3=rem, 4=awake** (numeric, not name)|
| `duration_minutes` | number | Minutes spent in this stage                            |
| `source`           | string |                                                        |

Multiple segments per (date, stage_type) are summed. `sleep_total_min` is derived as deep + rem + light + awake.

**`dedup_daily_steps[]`** — one row per day:

| Field     | Type   | Notes |
|-----------|--------|-------|
| `user_id` | int    |       |
| `date`    | string | `YYYY-MM-DD` |
| `steps`   | number | Integer count |
| `source`  | string |       |

#### Pipeline-derived features (output of featurization, not input)

These are computed for you from the rows above. They're listed here so you understand what the UMAP actually projects:

```
resting_hr, avg_hr, peak_hr,
sleep_deep_min, sleep_rem_min, sleep_light_min, sleep_awake_min, sleep_total_min,
steps
```

A day with sparse logging (missing HR or missing steps) is allowed — the pipeline imputes missing features with the cohort mean before UMAP. The day will land near the cohort centroid rather than at an extreme. **Don't drop incomplete days yourself** — the imputation is part of the design.

A reference input lives at [`pipeline/sample_input.json`](./pipeline/sample_input.json).

### 3b. Run the pipeline

```bash
# From repo root:
uv run --project pipeline heal-atlas pipeline/my_input.json public/atlas.json

# Re-attach the 6 MetricLens biomarkers (calories, VO₂max, HRV, …)
node pipeline/augment-biomarkers.mjs

# (Optional) Also surface the raw rows in the Raw table:
cp pipeline/my_input.json pipeline/generated_input.json
node pipeline/publish-raw.mjs
```

What each step does:

1. **`heal-atlas <in> <out>`** — featurizes per-day → fits UMAP on the synthetic cohort corpus (~800 rows) → `reducer.transform()` your days into the cohort space → emits an `AtlasDataset` JSON with cohort points + your user-day points. Deterministic (`random_state=42`); rerun → identical output.
2. **`augment-biomarkers`** — samples the 6 lens biomarkers per cohort/user and writes them under `meta.biomarkers.*` on every point. Without this the MetricLens panel renders empty.
3. **`publish-raw`** — copies your dedup dump to `public/raw.json` and tags every record with `atlas_point_id: "user-<date>"` so the Raw table → 3D selection bridge works.

### 3c. View it

```bash
task dev              # hot-reload at http://localhost:5173
```

Hard-refresh (Cmd+Shift+R) — Vite serves `public/` directly so no rebuild is needed. The red `user` cluster is your data. Click any point for the inspector; click an `atlas_point_id` link in the Raw tab to jump back to its 3D point.

For a production build:

```bash
task build            # → dist/
task preview          # serve dist/ on :4173 to sanity-check
task deploy           # vercel deploy --prod (requires `vercel login`)
```

---

## 4. Regenerate the demo data (no input file needed)

If `public/atlas.json` is missing, stale, or you want to see the app on fresh synthetic data:

```bash
task synth:reset      # generate → publish-raw → run pipeline → augment biomarkers
task dev              # hard-refresh
```

This runs four steps via [`Taskfile.yml`](Taskfile.yml):

1. `synth:generate` — emits 80 days of synthetic dedup records into `pipeline/generated_input.json` (means biased between `avg_male` and `elite_male`)
2. `synth:publish-raw` — copies to `public/raw.json` with `atlas_point_id` cross-links
3. `synth:atlas` — feeds it through the real Python pipeline → `public/atlas.json`
4. `synth:augment` — attaches the 6 lens biomarkers

To put the user cluster *inside* a named cohort centroid (useful for "I am the average male" demos):

```bash
task persona:reset PERSONA=elite_female PERSONA_DAYS=120
```

Available personas: `avg_male`, `avg_female`, `elite_male`, `elite_female`.

---

## 5. The output format (`AtlasDataset`)

The pipeline always emits this shape — the renderer doesn't accept anything else. Full TypeScript definition: [`src/schema/types.ts`](./src/schema/types.ts).

```json
{
  "meta": {
    "title": "Heal Atlas — user vs cohorts",
    "projection": "umap",
    "seed": 42,
    "sources": ["apple_health", "fitbit", "oura"]
  },
  "categories": [
    { "id": "avg_male",     "label": "Avg Male",     "color": "#60a5fa", "shape": "ellipsoid"    },
    { "id": "user",         "label": "User",         "color": "#ef4444", "shape": "icosahedron"  }
  ],
  "points": [
    {
      "id": "user-2024-05-01",
      "x": 1.2, "y": 0.4, "z": -0.8,
      "category": "user",
      "label": "2024-05-01",
      "value": 11240, "unit": "steps",
      "timestamp": 1714521600000,
      "meta": { "resting_hr": 54, "steps": 11240, "biomarkers": { "vo2max": 47 } }
    }
  ]
}
```

If you want to bypass the pipeline entirely and hand-author this format (or generate it from a different source), the renderer accepts the file via drag-and-drop in the in-app `DataLoader` panel.

---

## 6. The `AtlasDataset` schema reference

Use this if you're building your own pipeline / adapter to feed the renderer directly.

**Point fields** (`points[]`):

| Field          | Required | Type                    | What it enables                                          |
|----------------|----------|-------------------------|----------------------------------------------------------|
| `id`           | yes      | string \| number        | Unique identifier; required for selection & sorting      |
| `x`,`y`,`z`    | yes      | number                  | 3D position; typically projection output                 |
| `category`     | yes      | string                  | Must match a `categories[].id`; drives color & shape     |
| `label`        | no       | string                  | Display name shown in the table & event card            |
| `value`        | no       | number                  | Sortable metric in the table view                        |
| `unit`         | no       | string                  | Unit for `value` (e.g. `"steps"`, `"bpm"`)               |
| `timestamp`    | no       | number (ms since epoch) | Recency-based point sizing; recent events render larger  |
| `endTimestamp` | no       | number (ms since epoch) | End of interval — for window-based records              |
| `source`       | no       | string                  | Device origin; surfaces in filters                       |
| `userId`       | no       | string \| number        | Multi-user datasets only                                 |
| `meta`         | no       | object                  | Arbitrary extra fields shown in the event card           |

For MetricLens coloring, put biomarker values under `meta.biomarkers.{calories_intake, calories_burned, workout_min, vo2max, hrv, resting_hr}`. Ranges are configured in [`src/data/metrics.ts`](./src/data/metrics.ts).

**Category fields** (`categories[]`):

| Field      | Required | Type                                                                                                            | Notes                                          |
|------------|----------|-----------------------------------------------------------------------------------------------------------------|------------------------------------------------|
| `id`       | yes      | string                                                                                                          | Must match `points[].category`                 |
| `label`    | yes      | string                                                                                                          | Display name in legend / table                 |
| `color`    | yes      | string                                                                                                          | Any CSS color; hex recommended                 |
| `shape`    | no       | `"ellipsoid" \| "torus" \| "octahedron" \| "dodecahedron" \| "sphere" \| "icosahedron"`                          | Cluster surface primitive; defaults to ellipsoid |
| `position` | no       | `[number, number, number]`                                                                                       | Centroid override; otherwise computed          |

### Validation

The renderer validates with [Zod](https://zod.dev) at load time. Beyond per-field type checks the validator also catches:

- Points referencing undefined categories
- Duplicate point IDs

Errors come back with specific paths and counts.

---

## 7. The command surface

All multi-step flows go through [`Taskfile.yml`](Taskfile.yml). Full reference in [`COMMANDS.md`](./COMMANDS.md).

| Goal                                          | Command                  |
|-----------------------------------------------|--------------------------|
| Hot-reload dev server                         | `task dev`               |
| Production build → `dist/`                    | `task build`             |
| Atlas → build → deploy (Vercel)               | `task release`           |
| Regenerate demo data (no DB)                  | `task synth:reset`       |
| Persona-centered demo                         | `task persona:reset PERSONA=elite_male` |
| Reset DB and rehydrate from scratch           | `task data:reset`        |
| First-time setup on a new machine             | `task bootstrap`         |
| List every task                               | `task --list-all`        |

---

## 8. Architecture

```
embedding-atlas/
├── pipeline/                        Python: raw dedup JSON → AtlasDataset
│   ├── heal_atlas/
│   │   ├── cohorts.py               4 cohort priors + Gaussian sampler (see DESIGN.md §4)
│   │   ├── featurize.py             dedup_* → per-(user, date) feature DataFrame
│   │   ├── reduce.py                Fit UMAP on cohorts, transform user, emit atlas JSON
│   │   └── from_db.py               Postgres-driven path (skip on first run)
│   ├── augment-biomarkers.mjs       Re-attach 6 MetricLens biomarkers
│   ├── publish-raw.mjs              Build public/raw.json with atlas_point_id links
│   ├── generate-user-raw.mjs        Synthetic 80-day dedup generator
│   ├── generate-persona-raw.mjs     Persona-centered dedup generators
│   ├── sample_input.json            Reference input shape
│   └── DESIGN.md                    Why the pipeline does what it does
│
├── src/
│   ├── schema/                      Data contract — types, validator, adapters
│   ├── lib/                         Pure functions (convex hull, distances, prng)
│   ├── store/                       Zustand state (data + filters + ui)
│   ├── components/                  React: AtlasCanvas, PointCloud, MetricLens, …
│   ├── data/                        Static config (metrics, color ramps, archetypes)
│   └── App.tsx                      Top-level layout + data loading
│
├── heal-daily-pages/                Optional Postgres ingestion service
├── public/                          atlas.json + raw.json served to the SPA
└── Taskfile.yml                     Every command lives here
```

---

## 9. Performance limits

- **≤ 5,000 points** — smooth on any modern device.
- **5,000 – 50,000 points** — runs well; expect minor frame drops during legend hover (per-point recoloring).
- **50,000 – 500,000 points** — the default `THREE.Points` path slows down. Pre-aggregate or switch to instanced rendering.
- **> 500,000 points** — beyond the design point. Consider [deck.gl](https://deck.gl)'s `PointCloudLayer`.

The convex-hull algorithm is O(n²) and runs once per filter change. Above ~10k points the global hull computation may exceed 100ms.

---

## 10. License

MIT.
