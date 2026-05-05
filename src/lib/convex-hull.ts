/**
 * Incremental 3D convex hull.
 *
 * Algorithm:
 *   1. Find 4 extremal non-coplanar points → seed tetrahedron.
 *   2. For each remaining point P:
 *      a. Determine which existing faces are "visible" from P.
 *      b. If none visible, P is interior — skip.
 *      c. Otherwise, find the *horizon* — edges between visible and hidden faces.
 *      d. Delete visible faces. For each horizon edge, build a new triangle
 *         from that edge to P, preserving outward orientation.
 *   3. Return the surviving face list.
 *
 * Deterministic given a fixed input order. O(n²) worst case; runs comfortably
 * within a frame for n ≤ 5,000.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export type Triangle = [number, number, number];

export function convexHull3D<T extends Point3>(rawPoints: readonly T[]): Triangle[] {
  const n = rawPoints.length;
  if (n < 4) return [];
  const pts: [number, number, number][] = rawPoints.map(p => [p.x, p.y, p.z]);

  const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [
    a[0]! - b[0]!,
    a[1]! - b[1]!,
    a[2]! - b[2]!,
  ];
  const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const dot = (a: readonly number[], b: readonly number[]): number =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

  // Seed tetrahedron — find extremes along x for the seed line, then the
  // furthest point from that line, then the furthest from that triangle's plane.
  let i0 = 0, i1 = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i]![0] < pts[i0]![0]) i0 = i;
    if (pts[i]![0] > pts[i1]![0]) i1 = i;
  }
  if (i0 === i1) return [];

  let i2 = -1, best = 0;
  const dline = sub(pts[i1]!, pts[i0]!);
  const llen2 = dot(dline, dline) || 1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    const v = sub(pts[i]!, pts[i0]!);
    const c = cross(v, dline);
    const d2 = dot(c, c) / llen2;
    if (d2 > best) { best = d2; i2 = i; }
  }
  if (i2 === -1) return [];

  const planeN = cross(sub(pts[i1]!, pts[i0]!), sub(pts[i2]!, pts[i0]!));
  let i3 = -1; best = 1e-10;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    const d = Math.abs(dot(planeN, sub(pts[i]!, pts[i0]!)));
    if (d > best) { best = d; i3 = i; }
  }
  if (i3 === -1) return [];

  // Centroid of seed tetrahedron — used to orient initial faces outward.
  const interior: [number, number, number] = [
    (pts[i0]![0] + pts[i1]![0] + pts[i2]![0] + pts[i3]![0]) / 4,
    (pts[i0]![1] + pts[i1]![1] + pts[i2]![1] + pts[i3]![1]) / 4,
    (pts[i0]![2] + pts[i1]![2] + pts[i2]![2] + pts[i3]![2]) / 4,
  ];
  const orient = (f: Triangle): Triangle => {
    const N = cross(sub(pts[f[1]]!, pts[f[0]]!), sub(pts[f[2]]!, pts[f[0]]!));
    const toInside = sub(interior, pts[f[0]]!);
    return dot(N, toInside) > 0 ? [f[0], f[2], f[1]] : f;
  };

  let faces: Triangle[] = [
    orient([i0, i1, i2]),
    orient([i0, i1, i3]),
    orient([i0, i2, i3]),
    orient([i1, i2, i3]),
  ];

  const isVisible = (f: Triangle, p: number): boolean => {
    const N = cross(sub(pts[f[1]]!, pts[f[0]]!), sub(pts[f[2]]!, pts[f[0]]!));
    return dot(N, sub(pts[p]!, pts[f[0]]!)) > 1e-9;
  };

  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const visible: Triangle[] = [];
    const hidden: Triangle[] = [];
    for (const f of faces) {
      if (isVisible(f, i)) visible.push(f); else hidden.push(f);
    }
    if (visible.length === 0) continue;

    // Horizon = edges that appear in exactly one visible face.
    const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeCount = new Map<string, number>();
    for (const f of visible) {
      for (let e = 0; e < 3; e++) {
        const k = edgeKey(f[e]!, f[(e + 1) % 3]!);
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }
    const horizon: [number, number][] = [];
    for (const f of visible) {
      for (let e = 0; e < 3; e++) {
        const a = f[e]!, b = f[(e + 1) % 3]!;
        if (edgeCount.get(edgeKey(a, b)) === 1) horizon.push([a, b]);
      }
    }
    faces = hidden;
    for (const [a, b] of horizon) faces.push([a, b, i]);
  }
  return faces;
}
