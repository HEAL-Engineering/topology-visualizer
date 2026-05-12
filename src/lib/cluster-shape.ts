/**
 * PCA-based cluster shape fitting.
 *
 * For each cluster we compute:
 *   - centroid (3-vector)
 *   - orthonormal basis (3×3 rotation, the principal axes of the data)
 *   - half-axis lengths along each principal axis (= sigma · sqrt(eigenvalue))
 *
 * The ClusterShapes renderer takes a unit primitive (sphere, torus, ribbon),
 * scales it by halfAxes, and rotates it by basis — so the primitive ends up
 * oriented with the actual data spread instead of being axis-aligned.
 *
 * Why Jacobi rotation on a 3×3 covariance matrix instead of a library:
 *   - It's 3×3, so a hand-rolled symmetric eigendecomp is ~30 lines and runs
 *     in microseconds. No dep, no bundle size.
 *   - Closed-form cubic-roots (Smith 1961, Kopp 2008) are faster but get
 *     numerically wobbly near repeated eigenvalues; Jacobi is robust.
 *
 * Fallbacks:
 *   - < 4 points: return null. The renderer falls back to a small isotropic
 *     sphere at the bounding-box center (handled by the renderer, not here).
 *   - Degenerate covariance (near-zero spread on an axis): clamp the half-axis
 *     to a minimum so primitives don't collapse to invisible flats.
 */

import type { Point3 } from './convex-hull';

/** Multiply this by sqrt(eigenvalue) to get the half-axis length. Default 2σ. */
const DEFAULT_SIGMA = 2.0;

/** Floor on each half-axis to prevent invisible-flat ellipsoids/tori. */
const MIN_HALF_AXIS = 0.05;

export interface ClusterShape {
  centroid: [number, number, number];
  /**
   * Each row is a principal axis unit vector, sorted by eigenvalue
   * descending. basis[0] is the major axis, basis[2] the minor.
   * The renderer builds a Matrix3 with these as columns (i.e. transpose)
   * to get the local→world rotation.
   */
  basis: [[number, number, number], [number, number, number], [number, number, number]];
  /** Half-axis lengths aligned with `basis` rows (major → minor). */
  halfAxes: [number, number, number];
}

export interface PcaOptions {
  /** Sigma multiplier (default 2 = 2-sigma confidence ellipsoid). */
  sigma?: number;
}

export function pcaClusterShape<T extends Point3>(
  points: readonly T[],
  options: PcaOptions = {},
): ClusterShape | null {
  if (points.length < 4) return null;
  const sigma = options.sigma ?? DEFAULT_SIGMA;
  const n = points.length;

  // ── Centroid ────────────────────────────────────────────────────────────
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;

  // ── 3×3 covariance (symmetric) ─────────────────────────────────────────
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    xx += dx * dx; yy += dy * dy; zz += dz * dz;
    xy += dx * dy; xz += dx * dz; yz += dy * dz;
  }
  xx /= n; yy /= n; zz /= n; xy /= n; xz /= n; yz /= n;

  // ── Symmetric eigendecomposition via Jacobi rotation ───────────────────
  const cov: number[][] = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const { values, vectors } = jacobiEigen3(cov);

  // Sort eigen{values,vectors} descending by eigenvalue.
  const order = [0, 1, 2].sort((a, b) => values[b]! - values[a]!);
  const halfAxes: [number, number, number] = [0, 0, 0];
  const basis: ClusterShape['basis'] = [
    [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ];
  for (let k = 0; k < 3; k++) {
    const idx = order[k]!;
    halfAxes[k] = Math.max(MIN_HALF_AXIS, Math.sqrt(Math.max(0, values[idx]!)) * sigma);
    basis[k] = [vectors[0]![idx]!, vectors[1]![idx]!, vectors[2]![idx]!];
  }

  // Make sure the basis is right-handed (det > 0). If it's a reflection,
  // flip the smallest axis so primitives don't render inside-out.
  if (det3(basis) < 0) {
    basis[2] = [-basis[2][0], -basis[2][1], -basis[2][2]];
  }

  return { centroid: [cx, cy, cz], basis, halfAxes };
}

/**
 * Jacobi rotation for a 3×3 real symmetric matrix.
 *
 * Returns eigenvalues in `values[0..2]` and eigenvectors as columns of
 * `vectors[i][j]` (row i, column j). Converges in < 10 sweeps for 3×3.
 */
function jacobiEigen3(a: number[][]): { values: number[]; vectors: number[][] } {
  // Copy a since we mutate in place.
  const m: number[][] = a.map(row => row.slice());
  // Eigenvectors accumulate as identity rotated by each Jacobi step.
  const v: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let sweep = 0; sweep < 50; sweep++) {
    // Off-diagonal magnitude.
    const off = Math.abs(m[0]![1]!) + Math.abs(m[0]![2]!) + Math.abs(m[1]![2]!);
    if (off < 1e-12) break;

    // Sweep over the three off-diagonal pairs.
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = m[p]![q]!;
      if (Math.abs(apq) < 1e-14) continue;
      const app = m[p]![p]!, aqq = m[q]![q]!;
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      // Rotate rows/cols p,q of m.
      m[p]![p] = app - t * apq;
      m[q]![q] = aqq + t * apq;
      m[p]![q] = m[q]![p] = 0;
      for (let r = 0; r < 3; r++) {
        if (r !== p && r !== q) {
          const arp = m[r]![p]!, arq = m[r]![q]!;
          m[r]![p] = m[p]![r] = c * arp - s * arq;
          m[r]![q] = m[q]![r] = s * arp + c * arq;
        }
      }
      // Update eigenvectors.
      for (let r = 0; r < 3; r++) {
        const vrp = v[r]![p]!, vrq = v[r]![q]!;
        v[r]![p] = c * vrp - s * vrq;
        v[r]![q] = s * vrp + c * vrq;
      }
    }
  }

  return { values: [m[0]![0]!, m[1]![1]!, m[2]![2]!], vectors: v };
}

function det3(m: ClusterShape['basis']): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}
