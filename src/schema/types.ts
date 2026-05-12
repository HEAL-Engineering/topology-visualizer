/**
 * The canonical data format for embedding-atlas.
 *
 * Any data the renderer accepts must conform to AtlasDataset. Most users will
 * either format their data this way directly, or run it through one of the
 * adapters in ./adapters (CSV, alternative JSON shapes, etc.).
 *
 * Design principle: the minimum-viable point is just an id, three coordinates,
 * and a category. Everything else is optional and unlocks additional features.
 */

/**
 * A single point in 3D embedding space.
 *
 * Required fields:
 *   - id: any unique identifier (string or number)
 *   - x, y, z: 3D coordinates, typically the output of UMAP / t-SNE / PCA
 *   - category: identifier matching one of the Categories below; drives color
 *
 * Optional fields and what they enable:
 *   - label:         shown in the table column and event card; falls back to id
 *   - value:         numeric metric; enables value-based sorting in the table
 *   - unit:          unit string for `value` (e.g. "bpm", "minutes", "steps")
 *   - timestamp:     unix milliseconds; enables recency-based point sizing.
 *                    For interval-based metrics this is the start of the window.
 *   - endTimestamp:  unix milliseconds marking the end of an interval — set
 *                    when the underlying record covers a window (heart-rate
 *                    aggregates, sleep sessions). Omit for point-in-time data.
 *   - source:        data origin / device ("apple_health", "fitbit", "oura").
 *                    Independent from `category`; useful for filtering and
 *                    explaining provenance after cross-source dedup.
 *   - userId:        owning user — required for multi-user datasets, ignored
 *                    by the renderer for single-user views.
 *   - meta:          arbitrary additional fields shown in the event card
 *                    details (e.g. min/max bpm, dedup_strategy, source_count).
 */
export interface AtlasPoint {
  id: string | number;
  x: number;
  y: number;
  z: number;
  category: string;
  label?: string;
  value?: number;
  unit?: string;
  timestamp?: number;
  endTimestamp?: number;
  source?: string;
  userId?: string | number;
  meta?: Record<string, unknown>;
}

/**
 * A category definition. The `id` field must match `AtlasPoint.category`
 * values; orphan points (referencing a non-existent category) cause
 * validation to fail.
 */
export interface AtlasCategory {
  id: string;
  label: string;
  /** Any CSS color string. Hex (#ff6b6b) is recommended for predictability. */
  color: string;
  /**
   * Optional centroid hint, used to anchor Mapper-graph nodes and as a
   * fallback if the renderer needs a category position before any points
   * are rendered. If omitted, the centroid is computed from the cluster.
   */
  position?: [number, number, number];
  /**
   * Cluster surface shape kind. The renderer fits this primitive to the
   * cluster via PCA — distinct shape *kinds* give viewers a categorical
   * recognition cue beyond color alone. Defaults to 'ellipsoid' when
   * omitted (matches legacy datasets' visual baseline).
   */
  shape?: ClusterShapeKind;
}

/**
 * Per-category cluster surface primitive. See ClusterShapes renderer.
 *
 * Visual intent:
 *   ellipsoid    smooth, anisotropic — for distributions with clear spread
 *   torus        ring — for distributions with hollow / cyclic feel
 *   octahedron   sharp 6-vertex diamond — for "peak / extreme" cohorts
 *   dodecahedron 12-face crystal — for "structured but rounded" cohorts
 *   sphere       isotropic — when anisotropy shouldn't be implied
 *   icosahedron  compact 20-face — used for the `user` self-marker
 */
export type ClusterShapeKind =
  | 'ellipsoid'
  | 'torus'
  | 'octahedron'
  | 'dodecahedron'
  | 'sphere'
  | 'icosahedron';

/**
 * Top-level dataset spec. This is what the loader produces and what
 * components consume.
 */
export interface AtlasDataset {
  points: AtlasPoint[];
  categories: AtlasCategory[];
  /** Free-form metadata; surfaced in the UI when present */
  meta?: AtlasMeta;
}

export interface AtlasMeta {
  title?: string;
  description?: string;
  /** Source projection algorithm; surfaced in the UI for transparency */
  projection?: 'umap' | 't-sne' | 'pca' | 'mds' | 'isomap' | string;
  /** RNG seed if the dataset was generated; for reproducibility */
  seed?: number;
  /** When the dataset was generated/exported */
  generatedAt?: number;
  /**
   * Known data sources / devices represented in this dataset
   * (e.g. ["apple_health", "fitbit", "oura"]). Lets the UI pre-populate
   * source filters even before any points are scanned.
   */
  sources?: string[];
  /**
   * Domain of the dataset. Free-form, but a stable vocabulary
   * ("heart_rate", "sleep", "steps", "wellness") makes adapters reusable.
   */
  metric?: string;
}
