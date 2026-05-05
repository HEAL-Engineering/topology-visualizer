/**
 * Per-cluster polyhedral hull via icosahedral direction sampling.
 *
 * For each of 12 unit-vector directions (icosahedron vertices), we find the
 * cluster's most-extremal point in that direction. The icosahedron's 20 face
 * indices then connect those 12 points into a closed polyhedral surface.
 *
 * Why not a real convex hull per cluster?
 *   - Real hulls have variable vertex counts; visualization looks inconsistent.
 *   - Icosahedral sampling gives every cluster the same topology (12 verts,
 *     20 faces), so all clusters render as the same kind of shape, just
 *     scaled and oriented differently.
 *   - It's also faster (O(k·n) per cluster, no recursion).
 */

import type { Point3 } from './convex-hull';

const PHI = (1 + Math.sqrt(5)) / 2;

export const ICO_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [-1,  PHI,  0], [ 1,  PHI,  0], [-1, -PHI,  0], [ 1, -PHI,  0],
  [ 0, -1,  PHI], [ 0,  1,  PHI], [ 0, -1, -PHI], [ 0,  1, -PHI],
  [ PHI,  0, -1], [ PHI,  0,  1], [-PHI,  0, -1], [-PHI,  0,  1],
].map(v => {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / len, v[1]! / len, v[2]! / len] as const;
});

export const ICO_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
  [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
  [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
  [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
];

export interface ClusterHull {
  vertices: Array<[number, number, number]>;
  faces: ReadonlyArray<readonly [number, number, number]>;
}

export interface ClusterHullOptions {
  /** Outward push beyond the extremal point. 0 = hull touches points exactly. */
  padding?: number;
}

export function buildClusterHull<T extends Point3>(
  clusterPoints: readonly T[],
  options: ClusterHullOptions = {},
): ClusterHull | null {
  if (clusterPoints.length < 4) return null;
  const padding = options.padding ?? 0.08;

  const cx = clusterPoints.reduce((s, p) => s + p.x, 0) / clusterPoints.length;
  const cy = clusterPoints.reduce((s, p) => s + p.y, 0) / clusterPoints.length;
  const cz = clusterPoints.reduce((s, p) => s + p.z, 0) / clusterPoints.length;

  const vertices: Array<[number, number, number]> = ICO_DIRS.map(([dx, dy, dz]) => {
    let bestPoint = clusterPoints[0]!;
    let bestVal = -Infinity;
    for (const p of clusterPoints) {
      const v = (p.x - cx) * dx + (p.y - cy) * dy + (p.z - cz) * dz;
      if (v > bestVal) { bestVal = v; bestPoint = p; }
    }
    return [
      bestPoint.x + dx * padding,
      bestPoint.y + dy * padding,
      bestPoint.z + dz * padding,
    ];
  });

  return { vertices, faces: ICO_FACES };
}
