/**
 * Cluster distance metrics.
 *
 * In the demo we display centroid Euclidean distance for simplicity, but
 * production deployments often want different metrics. This module provides
 * all the common linkage strategies behind a single interface so users can
 * choose the right one for their data.
 *
 *   - centroid: distance between cluster means. Fast; ignores cluster shape.
 *   - single: min pairwise distance. Captures bridges; outlier-sensitive.
 *   - complete: max pairwise distance. Stable but pessimistic.
 *   - average: mean pairwise distance. Robust default for most use cases.
 *   - mahalanobis: covariance-aware. Best for elongated clusters where
 *     centroid distance would understate separation.
 *
 * For wellness/lifestream data and similar non-spherical UMAP clusters,
 * `average` is usually the right default; switch to `mahalanobis` when you
 * need shape-aware separation.
 */

import type { AtlasPoint } from '../schema/types';

export type DistanceMetric = 'centroid' | 'single' | 'complete' | 'average' | 'mahalanobis';

export interface DistanceMatrix {
  /** category id → category id → distance */
  matrix: Map<string, Map<string, number>>;
  /** Aggregate stats across all category pairs */
  min: number;
  max: number;
  mean: number;
  /** Pair with the minimum distance */
  tightestPair: [string, string] | null;
  /** Pair with the maximum distance */
  farthestPair: [string, string] | null;
  /** Per-category centroids; useful for downstream rendering */
  centroids: Map<string, [number, number, number]>;
}

export function clusterDistances(
  points: readonly AtlasPoint[],
  metric: DistanceMetric = 'centroid',
): DistanceMatrix {
  const byCategory = new Map<string, AtlasPoint[]>();
  for (const p of points) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  const centroids = new Map<string, [number, number, number]>();
  for (const [cat, ps] of byCategory) {
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const cz = ps.reduce((s, p) => s + p.z, 0) / ps.length;
    centroids.set(cat, [cx, cy, cz]);
  }

  const ids = [...byCategory.keys()];
  const matrix = new Map<string, Map<string, number>>();
  ids.forEach(id => matrix.set(id, new Map()));

  let dMin = Infinity, dMax = 0, dSum = 0, count = 0;
  let tightestPair: [string, string] | null = null;
  let farthestPair: [string, string] | null = null;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!, b = ids[j]!;
      const psA = byCategory.get(a)!, psB = byCategory.get(b)!;
      const d = computeMetric(metric, psA, psB, centroids.get(a)!, centroids.get(b)!);
      matrix.get(a)!.set(b, d);
      matrix.get(b)!.set(a, d);
      if (d < dMin) { dMin = d; tightestPair = [a, b]; }
      if (d > dMax) { dMax = d; farthestPair = [a, b]; }
      dSum += d;
      count++;
    }
  }

  return {
    matrix,
    min: count > 0 ? dMin : 0,
    max: count > 0 ? dMax : 0,
    mean: count > 0 ? dSum / count : 0,
    tightestPair,
    farthestPair,
    centroids,
  };
}

function computeMetric(
  metric: DistanceMetric,
  a: AtlasPoint[],
  b: AtlasPoint[],
  centroidA: [number, number, number],
  centroidB: [number, number, number],
): number {
  switch (metric) {
    case 'centroid':
      return Math.hypot(
        centroidA[0] - centroidB[0],
        centroidA[1] - centroidB[1],
        centroidA[2] - centroidB[2],
      );
    case 'single': {
      let m = Infinity;
      for (const pa of a) for (const pb of b) {
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        if (d < m) m = d;
      }
      return m;
    }
    case 'complete': {
      let m = 0;
      for (const pa of a) for (const pb of b) {
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        if (d > m) m = d;
      }
      return m;
    }
    case 'average': {
      let s = 0; let c = 0;
      for (const pa of a) for (const pb of b) {
        s += Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        c++;
      }
      return c > 0 ? s / c : 0;
    }
    case 'mahalanobis':
      // Mahalanobis between centroids using the pooled covariance of cluster A.
      // For symmetric Mahalanobis, callers can average d(A,B) and d(B,A).
      return mahalanobisDist(a, centroidA, centroidB);
  }
}

function mahalanobisDist(
  cluster: AtlasPoint[],
  centroid: [number, number, number],
  point: [number, number, number],
): number {
  // Compute 3x3 covariance matrix
  const n = cluster.length;
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (const p of cluster) {
    const dx = p.x - centroid[0], dy = p.y - centroid[1], dz = p.z - centroid[2];
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }
  const k = n > 1 ? 1 / (n - 1) : 1;
  cxx *= k; cxy *= k; cxz *= k; cyy *= k; cyz *= k; czz *= k;

  // Invert 3x3 symmetric matrix via cofactors
  const a11 = cyy * czz - cyz * cyz;
  const a12 = cxz * cyz - cxy * czz;
  const a13 = cxy * cyz - cxz * cyy;
  const det = cxx * a11 + cxy * a12 + cxz * a13;
  if (Math.abs(det) < 1e-12) {
    // Singular covariance — fall back to Euclidean
    return Math.hypot(point[0] - centroid[0], point[1] - centroid[1], point[2] - centroid[2]);
  }
  const id = 1 / det;
  const i11 = a11 * id, i12 = a12 * id, i13 = a13 * id;
  const i22 = (cxx * czz - cxz * cxz) * id;
  const i23 = (cxz * cxy - cxx * cyz) * id;
  const i33 = (cxx * cyy - cxy * cxy) * id;

  const dx = point[0] - centroid[0], dy = point[1] - centroid[1], dz = point[2] - centroid[2];
  const md = i11 * dx * dx + 2 * i12 * dx * dy + 2 * i13 * dx * dz
           + i22 * dy * dy + 2 * i23 * dy * dz
           + i33 * dz * dz;
  return Math.sqrt(Math.max(0, md));
}
