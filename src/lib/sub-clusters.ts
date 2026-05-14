/**
 * sub-clusters — partition a category's points into spatially-disjoint
 * subgroups before fitting a PCA shape to each.
 *
 * The problem this solves: when UMAP projects a category's points into two
 * distinct lobes (e.g. user-days that straddle the avg→elite corridor),
 * a single PCA-fit ellipsoid stretches across both lobes and the visual
 * bridge in the middle is empty. Splitting first gives one shape per lobe.
 *
 * Algorithm: single-linkage clustering on Euclidean distance with a
 * data-driven threshold derived from the median nearest-neighbor distance.
 * O(n²) per category — fine for n ≤ a few hundred points; a k-d tree would
 * be needed past that.
 *
 *   1. Per-point nearest-neighbor distance (n² scan).
 *   2. Threshold = MULT × median(nearest-neighbor distances).
 *   3. Union-find: connect every pair within threshold.
 *   4. Group by root, drop components smaller than MIN_COMPONENT_SIZE
 *      (treated as noise; folded into the largest component to avoid
 *      isolated 1–3-point "shapes" that PCA can't fit anyway).
 *   5. Sort by size descending — the renderer can use index 0 as the
 *      "primary" subcluster for label placement.
 */

import type { Point3 } from './convex-hull';

/** Multiplier on median NN distance. Higher = more permissive linkage
 *  (fewer splits). 4× catches gaps that are visibly distinct on screen
 *  while ignoring within-cluster noise. */
const LINK_MULTIPLIER = 4;

/** Below this point count, splitting is skipped — too few points to
 *  reliably estimate the NN distribution. */
const MIN_SPLIT_INPUT = 8;

/** Components smaller than this get absorbed into the largest component
 *  rather than rendered as their own shape. PCA needs ≥ 4 points. */
const MIN_COMPONENT_SIZE = 4;

export interface SubClusterOptions {
  linkMultiplier?: number;
  minComponentSize?: number;
}

/**
 * Partition `points` into spatially-disjoint subclusters. Always returns
 * at least one subcluster (the full input) when no meaningful split is
 * found. Result is sorted by subcluster size descending.
 */
export function splitIntoSubClusters<T extends Point3>(
  points: readonly T[],
  options: SubClusterOptions = {},
): T[][] {
  const n = points.length;
  if (n < MIN_SPLIT_INPUT) return [Array.from(points)];

  const linkMult = options.linkMultiplier ?? LINK_MULTIPLIER;
  const minSize = options.minComponentSize ?? MIN_COMPONENT_SIZE;

  // 1. Nearest-neighbor distance per point.
  const nnDist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    const pi = points[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pj = points[j]!;
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const dz = pi.z - pj.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    nnDist[i] = Math.sqrt(best);
  }

  // 2. Threshold = LINK_MULTIPLIER × median NN distance.
  const sortedNN = Float64Array.from(nnDist).sort();
  const median = sortedNN[Math.floor(n / 2)]!;
  const threshold = median * linkMult;
  const threshold2 = threshold * threshold;

  // 3. Union-find over points within threshold.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;  // path compression
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    const pi = points[i]!;
    for (let j = i + 1; j < n; j++) {
      const pj = points[j]!;
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const dz = pi.z - pj.z;
      if (dx * dx + dy * dy + dz * dz < threshold2) union(i, j);
    }
  }

  // 4. Group by root.
  const groups = new Map<number, T[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(points[i]!);
    groups.set(r, g);
  }
  const components = Array.from(groups.values()).sort((a, b) => b.length - a.length);

  // 5. Absorb tiny components into the primary so we don't render noise as
  //    its own shape. If after absorption only one component remains, that's
  //    a no-op compared to the original behavior — desired.
  if (components.length <= 1) return components;
  const primary = components[0]!;
  const kept: T[][] = [primary];
  for (let k = 1; k < components.length; k++) {
    const comp = components[k]!;
    if (comp.length >= minSize) kept.push(comp);
    else primary.push(...comp);
  }
  return kept;
}
