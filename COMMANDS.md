# Commands

All multi-step flows go through [`Taskfile.yml`](Taskfile.yml). Install Task
once (`brew install go-task` on macOS), then run `task --list-all` to see
everything available.

## Quick reference

| Goal                                                | Command              |
| --------------------------------------------------- | -------------------- |
| Hot-reload dev server                               | `task dev`           |
| Production build → `dist/`                          | `task build`         |
| Preview the built bundle locally                    | `task preview`       |
| Deploy `dist/` to Vercel prod                       | `task deploy`        |
| Atlas → build → deploy (single command)             | `task release`       |
| **Reset DB and rehydrate from scratch**             | `task data:reset`    |
| **Reset demo data without touching Postgres**       | `task synth:reset`   |
| First-time setup on a new machine                   | `task bootstrap`     |
| List every task                                     | `task --list-all`    |

## Reset the database and rehydrate from scratch

This is the canonical "blow it all away and rebuild" path. Postgres-driven.

```
task data:reset
```

That single command runs, in order:

1. `task db:reset` — drops the Postgres volume, restarts it, applies migrations
2. `task backfill` — replays the bundled fixture (`sample_user_30days.json`)
   into the empty database
3. `task atlas` — re-derives `public/atlas.json` from the now-populated DB
4. `task synth:augment` — re-attaches the six MetricLens biomarkers
   (calories, VO₂max, HRV, etc.) onto `meta.biomarkers` for every point.
   Without this the lens panel renders no colors after a reset.

**To see the change in the frontend:**

- **`task dev`** — hard-refresh the browser (Cmd+Shift+R). Vite serves
  `public/atlas.json` directly so no rebuild is needed.
- **`task preview` or production deploy** — run `task build` after the reset
  so `dist/atlas.json` is regenerated, then hard-refresh.

After it finishes, run `task build` (or `task release` to also deploy).

Knobs (set inline before the command):

```
task data:reset TODAY=2026-04-30 DAYS=60 USER_ID=00000000-0000-0000-0000-000000000007
```

`TODAY` is the anchor date the backfill walks back from; `DAYS` is how many
days of synthetic daily_pages to insert; `USER_ID` is who owns them.

## Reset demo data without touching Postgres

When you want to regenerate the **synthetic** dataset (the one served from
`public/atlas.json` + `public/raw.json`) without spinning up Postgres or
running backfill. Useful for demos and offline development.

```
task synth:reset
```

That runs, in order:

1. `task synth:generate` — `pipeline/generate-user-raw.mjs` emits 80 days of
   fake dedup records into `pipeline/generated_input.json`
2. `task synth:publish-raw` — `pipeline/publish-raw.mjs` copies it to
   `public/raw.json` with an `atlas_point_id` field added to every record
   so the Raw table shows the raw → atlas provenance
3. `task synth:atlas` — `uv run heal-atlas` feeds `generated_input.json`
   through the real Python pipeline (featurize + UMAP transform), writing
   `public/atlas.json`
4. `task synth:augment` — `pipeline/augment-biomarkers.mjs` attaches the
   six lens biomarkers (calories, VO₂max, HRV, etc.) under
   `meta.biomarkers` on every point

After it finishes, `task dev` (which serves `public/` directly) shows the
fresh data on hard-refresh, or `task build` if you're shipping the bundle.

## Raw → atlas conversion demo

To visually demonstrate that the user's atlas points are derived from the
raw dedup records (and not pre-baked synthetic positions), there's a
two-step flow that empties the user cluster, then re-derives it from
`public/raw.json` via the real Python pipeline.

**Step 1 — clear the user cluster:**

```
task demo:clear-user
```

Hard-refresh the browser. Cohort clusters stay visible; the user cluster
is gone. The Raw tab still shows all 480 records — they exist, just
nothing has been derived from them yet.

**Step 2 — hydrate from raw records:**

```
task demo:hydrate-user
```

This feeds `public/raw.json` through `uv run heal-atlas` (the Python
pipeline: featurize → UMAP transform), then runs `augment-biomarkers` so
the MetricLens works. Hard-refresh the browser to see the user cluster
reappear, derived from the raw records you just saw in the Raw tab.

Click any green `atlas_point_id` link in the Raw table — it'll select the
freshly-derived user-day point in 3D space.

The conversion is deterministic (UMAP seeded), so re-running `demo:hydrate-user`
produces identical 3D coordinates each time.

## Database operations

| Goal                                                | Command           |
| --------------------------------------------------- | ----------------- |
| Start Postgres                                      | `task db:up`      |
| Stop Postgres (data persists)                       | `task db:down`    |
| Apply migrations                                    | `task db:migrate` |
| Open `psql` shell                                   | `task db:psql`    |
| Drop + recreate the database (DESTRUCTIVE)          | `task db:reset`   |

`db:reset` is the dangerous one. It tears down the docker volume — there's
no recovery — and then re-applies migrations against an empty DB.

## Pipeline tasks (synthetic path, individually)

You usually want `task synth:reset` to run all four. The individual tasks
are exposed for partial reruns (e.g. you tweaked biomarker means and only
need to re-augment, not regenerate UMAP coordinates):

| Task                    | Reads                            | Writes                          |
| ----------------------- | -------------------------------- | ------------------------------- |
| `task synth:generate`   | nothing                          | `pipeline/generated_input.json` |
| `task synth:publish-raw`| `pipeline/generated_input.json`  | `public/raw.json`               |
| `task synth:atlas`      | `pipeline/generated_input.json`  | `public/atlas.json`             |
| `task synth:augment`    | `public/atlas.json`              | `public/atlas.json` (in place)  |

## Pipeline tasks (Postgres path, individually)

| Task             | Reads                                | Writes                          |
| ---------------- | ------------------------------------ | ------------------------------- |
| `task backfill`  | bundled fixture JSON                 | Postgres `daily_pages`          |
| `task atlas`     | Postgres `daily_pages`               | `public/atlas.json`             |

Knob: `task backfill TODAY=2026-04-30 DAYS=30 USER_ID=00000000-...`

## Build / deploy

| Goal                                                | Command          |
| --------------------------------------------------- | ---------------- |
| Vite production build                               | `task build`     |
| Preview the build at `http://localhost:4173`        | `task preview`   |
| Deploy existing `dist/` to Vercel prod              | `task deploy`    |
| Atlas → build → deploy                              | `task release`   |

`task release` is what runs in normal "ship a new dataset" flow.

## Search

```
task search QUERY="restorative sleep"
```

Lexical search over the daily_pages table; overrides `QUERY` and optionally
`USER_ID`.

## Installs

| Goal                                                | Command              |
| --------------------------------------------------- | -------------------- |
| Install everything (web + py + pipeline)            | `task install`       |
| Remove `dist/`, `node_modules`, `.venv`s            | `task clean`         |
| First-time machine setup (installs + DB + atlas)    | `task bootstrap`     |

`task clean` does NOT touch the Postgres volume — your DB data survives.
Use `task db:reset` for that.

## When in doubt

- **Just want fresh demo data on the map** → `task synth:reset && task dev`
- **Just want to clear Postgres and start over** → `task data:reset`
- **Want to watch the raw → atlas conversion happen live** → `task demo:clear-user` (refresh) then `task demo:hydrate-user` (refresh)
- **Want to ship a new dataset to prod** → `task release`
- **First time setting up the repo** → `task bootstrap`
