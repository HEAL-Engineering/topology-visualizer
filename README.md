# embedding-atlas

Interactive 3D visualization for embedding data. Drop in any 3D point cloud with categorical labels — UMAP, t-SNE, PCA, learned embeddings, or hand-authored coordinates — and get a navigable atlas with cluster hulls, a global manifold envelope, a Mapper-graph overlay, filterable categories, a sortable table view, and bidirectional 3D ↔ table selection.

Originally built as a visualization for [HEAL](https://example.com)'s wellness lifestream data; generalized into a standalone tool because the same problem shows up everywhere.

## Quick start

```bash
pnpm install
pnpm dev
```

The app boots with a sample wellness dataset. To visualize your own data, drop a file matching the schema below into the loader, or fetch from a URL.

## The data format

Every dataset is an `AtlasDataset` — three required arrays plus optional metadata. The full TypeScript definition lives in [`src/schema/types.ts`](./src/schema/types.ts); here's the human-readable version.

### Minimal example

```json
{
  "categories": [
    { "id": "alpha", "label": "Cluster A", "color": "#ff6b6b" },
    { "id": "beta",  "label": "Cluster B", "color": "#4ecdc4" }
  ],
  "points": [
    { "id": 0, "x": 1.2, "y": 0.4, "z": -0.8, "category": "alpha" },
    { "id": 1, "x": 1.5, "y": 0.1, "z": -1.1, "category": "alpha" },
    { "id": 2, "x": -2.0, "y": 1.8, "z": 0.3, "category": "beta"  }
  ]
}
```

That's enough to render. Everything else is optional and unlocks features.

### Field reference

**Point fields** (`points[]`):

| Field       | Required | Type                       | What it enables                                       |
|-------------|----------|----------------------------|-------------------------------------------------------|
| `id`        | yes      | string \| number           | Unique identifier; required for selection & sorting   |
| `x`,`y`,`z` | yes      | number                     | 3D position; typically projection output              |
| `category`  | yes      | string                     | Must match a `categories[].id`; drives color          |
| `label`     | no       | string                     | Display name shown in the table & event card          |
| `value`     | no       | number                     | Sortable metric in the table view                     |
| `timestamp` | no       | number (ms since epoch)    | Recency-based point sizing; recent events render larger |
| `meta`      | no       | object                     | Arbitrary additional fields shown in the event card   |

**Category fields** (`categories[]`):

| Field      | Required | Type                                    | Notes                                          |
|------------|----------|-----------------------------------------|------------------------------------------------|
| `id`       | yes      | string                                  | Must match `points[].category`                 |
| `label`    | yes      | string                                  | Display name in legend, table, etc.            |
| `color`    | yes      | string                                  | Any CSS color; hex recommended                 |
| `position` | no       | `[number, number, number]`              | Centroid override; otherwise computed from data |

**Mapper edge fields** (`mapperEdges[]`, optional):

| Field    | Required | Type                       | Notes                                  |
|----------|----------|----------------------------|----------------------------------------|
| `from`   | yes      | string                     | Source category id                     |
| `to`     | yes      | string                     | Target category id                     |
| `weight` | no       | number in `[0, 1]`         | Edge strength; controls opacity        |

### Validation

All datasets are validated at load time with [Zod](https://zod.dev). Beyond per-field type checks, the validator also catches:

- Points referencing undefined categories
- Mapper edges with dangling endpoints
- Duplicate point IDs

Errors come back with specific paths and counts (e.g., "47 points reference undefined categories") rather than the generic Zod stack trace.

## Getting your data into the format

The renderer only understands canonical `AtlasDataset` JSON. For other shapes, use an adapter from [`src/schema/adapters/`](./src/schema/adapters):

### CSV

```ts
import { csvToDataset } from '@schema/adapters/csv';

const dataset = csvToDataset(csvText, {
  autoCategorize: true,                // generate categories from unique column values
  columnMap: { x: 'umap_x', y: 'umap_y', z: 'umap_z', category: 'cluster' },
});
```

CSVs work well when your data is dense, tabular, and shares a single category column. The adapter auto-generates categories from unique values in the category column and assigns colors from a default palette. For full control over category display names and colors, generate the categories block separately.

### JSON with custom shape

```ts
import { jsonToDataset } from '@schema/adapters/json';

const dataset = jsonToDataset(rawJson, (raw) => ({
  points: raw.observations.map(o => ({
    id: o.observation_id,
    x: o.umap[0], y: o.umap[1], z: o.umap[2],
    category: o.cluster_label,
    label: o.event_name,
    value: o.score,
  })),
  categories: raw.cluster_meta.map(c => ({
    id: c.label,
    label: c.display_name,
    color: c.hex_color,
  })),
}));
```

### URL fetch

```ts
import { loadDatasetFromURL } from '@schema/adapters/json';

const dataset = await loadDatasetFromURL('https://example.com/embedding.json');
```

CORS applies — host the JSON somewhere that allows cross-origin requests, or proxy through your own server.

### Generating UMAP/t-SNE output to canonical form

A typical Python pipeline:

```python
import json, umap

# Compute embedding
reducer = umap.UMAP(n_components=3, random_state=42)
coords = reducer.fit_transform(features)

# Build canonical dataset
dataset = {
    "meta": {"projection": "umap", "seed": 42},
    "categories": [
        {"id": label, "label": label, "color": palette[i]}
        for i, label in enumerate(unique_labels)
    ],
    "points": [
        {"id": i, "x": float(c[0]), "y": float(c[1]), "z": float(c[2]),
         "category": labels[i], "label": names[i]}
        for i, c in enumerate(coords)
    ],
}

with open("dataset.json", "w") as f:
    json.dump(dataset, f)
```

## Performance limits

- **≤ 5,000 points** — works smoothly on any modern device.
- **5,000 – 50,000 points** — runs well; expect minor frame drops during legend hover (per-point recoloring).
- **50,000 – 500,000 points** — the default `THREE.Points` path slows down. Switch to `<DenseCloud>` (instanced rendering, planned for v0.2) or pre-aggregate.
- **> 500,000 points** — beyond the design point of this tool. Consider [deck.gl](https://deck.gl)'s `PointCloudLayer` or a tiled rendering approach.

The convex-hull algorithm is O(n²) and runs once per filter change. For datasets above ~10k points the global hull computation may take >100ms; consider memoizing or computing server-side.

## Architecture

```
src/
├── schema/                  Data contract — types, validators, adapters
│   ├── types.ts             Canonical AtlasDataset / Point / Category types
│   ├── validate.ts          Zod schemas + cross-field integrity checks
│   └── adapters/            Format converters
│       ├── csv.ts           CSV → AtlasDataset
│       └── json.ts          JSON → AtlasDataset (with optional transform)
├── lib/                     Pure functions, no React
│   ├── convex-hull.ts       3D incremental convex hull
│   ├── cluster-hull.ts      Per-cluster icosahedral hull
│   ├── distances.ts         Cluster centroid distance metrics
│   └── prng.ts              Deterministic seeded RNG
├── store/                   Zustand state slices
│   ├── data.ts              Loaded dataset + derived computations
│   ├── filters.ts           Dimension/event-type filter state
│   └── ui.ts                View toggles, selection, table sort
├── components/              React components
│   ├── AtlasCanvas.tsx      <Canvas> wrapper, scene composition
│   ├── PointCloud.tsx       The points layer
│   ├── ClusterHulls.tsx     Per-cluster hulls
│   ├── GlobalHull.tsx       Global manifold hull (filter-reactive)
│   ├── MapperGraph.tsx      Mapper-graph overlay
│   ├── FilterPanel.tsx      Bottom-left filter UI
│   ├── TablePanel.tsx       Right-side tabular view
│   ├── ControlBar.tsx       Top-bar view toggles
│   └── EventCard.tsx        Selected-event inspector
└── App.tsx                  Top-level: data loading + layout
```

## Contributing

PRs welcome. The schema is the contract — changes to `AtlasDataset` need a migration path documented in `CHANGELOG.md` and a major-version bump.

Areas where help would be especially welcome:

- **More adapters** — Parquet, NetCDF, Arrow, scikit-learn pickle export.
- **Performance scaling** — instanced rendering for the 50k+ point regime.
- **Additional projections** — built-in PCA / UMAP / t-SNE in WASM, so users can drop in a feature matrix and get an atlas without a Python pipeline.
- **Persistent state** — URL-encoded filter and selection state for shareable views.

## License

MIT.
