/**
 * JSON adapter — loads canonical-shape datasets directly, or applies a
 * user-provided transform if the JSON has a different shape.
 *
 * For the common case of canonical JSON, just call jsonToDataset(text).
 *
 * For non-canonical JSON (e.g., scikit-learn export with snake_case fields,
 * pandas to_json output, custom backend dumps), pass a transform function:
 *
 *   jsonToDataset(text, (raw) => ({
 *     points: raw.observations.map(o => ({
 *       id: o.observation_id,
 *       x: o.umap[0], y: o.umap[1], z: o.umap[2],
 *       category: o.cluster_label,
 *       label: o.event_name,
 *     })),
 *     categories: raw.cluster_meta.map(c => ({
 *       id: c.label, label: c.display_name, color: c.hex_color,
 *     })),
 *   }));
 */
import type { AtlasDataset } from '../types';
import { validateDataset } from '../validate';

export interface JSONAdapterOptions {
  skipValidation?: boolean;
}

export function jsonToDataset(
  jsonText: string,
  transform?: (raw: unknown) => AtlasDataset,
  options: JSONAdapterOptions = {},
): AtlasDataset {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const dataset = transform ? transform(raw) : (raw as AtlasDataset);
  return options.skipValidation ? dataset : validateDataset(dataset);
}

/**
 * Load a dataset from a remote URL. Uses fetch under the hood; respects CORS.
 */
export async function loadDatasetFromURL(
  url: string,
  transform?: (raw: unknown) => AtlasDataset,
): Promise<AtlasDataset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return jsonToDataset(text, transform);
}
