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
 *   - label:     shown in the table column and event card; falls back to id
 *   - value:     numeric metric; enables value-based sorting in the table
 *   - timestamp: unix milliseconds; enables recency-based point sizing
 *   - meta:      arbitrary additional fields shown in the event card details
 */
export interface AtlasPoint {
  id: string | number;
  x: number;
  y: number;
  z: number;
  category: string;
  label?: string;
  value?: number;
  timestamp?: number;
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
}

/**
 * A topological connection between two categories — used to draw the
 * Mapper-graph overlay. Weight controls edge opacity (0 invisible, 1 full).
 */
export interface AtlasMapperEdge {
  /** Category id of the source node */
  from: string;
  /** Category id of the target node */
  to: string;
  /** Edge strength in [0, 1]; defaults to 0.5 if omitted */
  weight?: number;
}

/**
 * Top-level dataset spec. This is what the loader produces and what
 * components consume.
 */
export interface AtlasDataset {
  points: AtlasPoint[];
  categories: AtlasCategory[];
  /** Optional Mapper-graph overlay edges */
  mapperEdges?: AtlasMapperEdge[];
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
}
