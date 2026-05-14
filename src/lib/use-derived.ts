/**
 * Derived state hook — pulls dataset + filter state from the store and
 * computes per-cluster shapes, filtered points, inter-cluster distances,
 * and per-category counts.
 *
 * All computations are memoized on their inputs, so toggling a UI flag
 * (showHulls, autoRotate) doesn't trigger any recomputation.
 */
import { useMemo } from 'react';
import { useAtlasStore } from '../store';
import { pcaClusterShape, type ClusterShape } from '../lib/cluster-shape';
import { splitIntoSubClusters } from '../lib/sub-clusters';
import { clusterDistances } from '../lib/distances';
import type { AtlasCategory, AtlasPoint } from '../schema/types';

export interface CategoryShape {
  category: AtlasCategory;
  shape: ClusterShape;
  /** Sub-cluster index within this category (0 = largest). Categories whose
   *  points form spatially-disjoint groups emit one CategoryShape per group;
   *  consumers index into refs by this entry's array position, not subIndex. */
  subIndex: number;
  /** Total subclusters this category was split into (1 for the common case). */
  subCount: number;
  /** Point count for this specific subcluster (not the whole category). */
  pointCount: number;
}

export function useDerivedState() {
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);

  // Per-category PCA shape(s). Each category's points are first partitioned
  // into spatially-disjoint subclusters (single-linkage on 4× median NN
  // distance) so that a category whose points form two visually-distinct
  // lobes gets one ellipsoid per lobe, not one ellipsoid spanning the gap.
  // Cohort clusters (tight gaussians) always collapse to a single subcluster,
  // matching legacy behavior. Independent of filters — shapes reflect the
  // full cluster topology, not the visible subset.
  //
  // Returns:
  //   clusterShapes:  one CategoryShape per (category × sub-cluster)
  //   pointSubIndex:  point.id → subIndex, for resolving clicks back to lobe
  const { clusterShapes, pointSubIndex } = useMemo<{
    clusterShapes: CategoryShape[];
    pointSubIndex: Map<string | number, number>;
  }>(() => {
    const shapes: CategoryShape[] = [];
    const subMap = new Map<string | number, number>();
    if (!dataset) return { clusterShapes: shapes, pointSubIndex: subMap };
    for (const cat of dataset.categories) {
      const clusterPoints = dataset.points.filter(p => p.category === cat.id);
      const subs = splitIntoSubClusters(clusterPoints);
      for (let k = 0; k < subs.length; k++) {
        const subPoints = subs[k]!;
        for (const p of subPoints) subMap.set(p.id, k);
        const shape = pcaClusterShape(subPoints);
        if (shape) {
          shapes.push({
            category: cat,
            shape,
            subIndex: k,
            subCount: subs.length,
            pointCount: subPoints.length,
          });
        }
      }
    }
    return { clusterShapes: shapes, pointSubIndex: subMap };
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

  return { clusterShapes, pointSubIndex, filteredWithIdx, distances, stats };
}
