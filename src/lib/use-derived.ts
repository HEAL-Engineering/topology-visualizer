/**
 * Derived state hook — pulls dataset + filter state from the store and
 * computes filtered points, per-cluster hulls, and global hull.
 *
 * All computations are memoized on their inputs, so toggling a UI flag
 * (showHulls, autoRotate) doesn't trigger any recomputation.
 */
import { useMemo } from 'react';
import { useAtlasStore } from '../store';
import { pcaClusterShape, type ClusterShape } from '../lib/cluster-shape';
import { convexHull3D, type Triangle } from '../lib/convex-hull';
import { clusterDistances } from '../lib/distances';
import type { AtlasCategory, AtlasPoint } from '../schema/types';

export interface CategoryShape {
  category: AtlasCategory;
  shape: ClusterShape;
}

export function useDerivedState() {
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);

  // PCA-fit shape per category: centroid + principal-axis basis + half-axes.
  // Independent of filters (shape reflects the full cluster, not the visible
  // subset). Categories with < 4 points are dropped — the renderer falls
  // back to a small isotropic sphere via the category.position field.
  const clusterShapes = useMemo<CategoryShape[]>(() => {
    if (!dataset) return [];
    const out: CategoryShape[] = [];
    for (const cat of dataset.categories) {
      const clusterPoints = dataset.points.filter(p => p.category === cat.id);
      const shape = pcaClusterShape(clusterPoints);
      if (shape) out.push({ category: cat, shape });
    }
    return out;
  }, [dataset]);

  // Filtered points (annotated with original index for hull index remapping).
  const filteredWithIdx = useMemo(() => {
    if (!dataset) return [];
    const out: Array<AtlasPoint & { _origIdx: number }> = [];
    dataset.points.forEach((p, i) => {
      if (!enabledCategories.has(p.category)) return;
      const labelKey = `${p.category}::${p.label ?? ''}`;
      if (p.label && !enabledLabels.has(labelKey)) return;
      out.push({ ...p, _origIdx: i });
    });
    return out;
  }, [dataset, enabledCategories, enabledLabels]);

  // Global convex hull over filtered points; faces remapped to original indices.
  const globalHull = useMemo<Triangle[]>(() => {
    if (filteredWithIdx.length < 4) return [];
    const localFaces = convexHull3D(filteredWithIdx);
    return localFaces.map(face => [
      filteredWithIdx[face[0]]!._origIdx,
      filteredWithIdx[face[1]]!._origIdx,
      filteredWithIdx[face[2]]!._origIdx,
    ] as Triangle);
  }, [filteredWithIdx]);

  // Inter-cluster distances (full data, not filtered).
  const distances = useMemo(() => {
    if (!dataset) return null;
    return clusterDistances(dataset.points, 'centroid');
  }, [dataset]);

  // Per-category counts.
  const stats = useMemo(() => {
    const total: Record<string, number> = {};
    const visible: Record<string, number> = {};
    if (!dataset) return { total, visible, totalVisible: 0 };
    for (const p of dataset.points) {
      total[p.category] = (total[p.category] ?? 0) + 1;
      const labelKey = `${p.category}::${p.label ?? ''}`;
      const labelOk = !p.label || enabledLabels.has(labelKey);
      if (enabledCategories.has(p.category) && labelOk) {
        visible[p.category] = (visible[p.category] ?? 0) + 1;
      }
    }
    const totalVisible = Object.values(visible).reduce((a, b) => a + b, 0);
    return { total, visible, totalVisible };
  }, [dataset, enabledCategories, enabledLabels]);

  return { clusterShapes, filteredWithIdx, globalHull, distances, stats };
}
