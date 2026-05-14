/**
 * Phantom trajectory projection.
 *
 * Computes a synthetic "could-be" point cluster representing where the
 * user's daily-page topology would land if they followed every action
 * item in their archetype reading and converged on the chosen elite
 * cohort. The phantom cluster is rendered alongside (not in place of)
 * the actual user cluster so the user sees the gap between *what is*
 * and *what could be* — a behavior nudge baked into the geometry.
 *
 * Approach:
 *   1. Compute the user's baseline centroid from *non-injected* user
 *      points (so previously logged behaviors don't compound into the
 *      starting state — they're already reflected in the actual cluster).
 *   2. For each phantom point, pick a random elite member and blend its
 *      position toward the user centroid at `(1 - completion)` — i.e.
 *      `completion = 0.92` means the phantom sits 92% of the way to the
 *      elite cluster, with the remaining 8% retaining a memory of the
 *      user's starting region.
 *   3. Add jitter scaled to the elite cluster's spread so the phantom
 *      looks like a real lived-in distribution, not a single goal dot.
 *
 * Why "blend toward user" instead of just copying elite points:
 *   - A pure copy of elite points would visually merge with the elite
 *     cluster — the user couldn't tell they're separate.
 *   - The blend leaves a small offset so the phantom forms a distinct
 *     cluster, slightly closer to the user's actual position.
 *   - It also makes the trajectory shorter for users who are already
 *     near elite (they don't need to "travel" as far in the visual).
 *
 * Output is consumed by `PhantomTrajectory.tsx` for rendering and stored
 * in the Zustand store so other panels can reference its summary stats.
 */
import type { AtlasDataset, AtlasPoint, AtlasCategory } from '../schema/types';
import { pcaClusterShape, type ClusterShape } from './cluster-shape';

export type PhantomTargetId = 'elite_male' | 'elite_female';

export interface PhantomTrajectory {
  /** Synthetic AtlasPoints (category id = `user_phantom`). */
  points: AtlasPoint[];
  /** PCA fit of the phantom point cluster — drives the ghost shape render. */
  shape: ClusterShape;
  /** Synthetic category used by the renderer for color + shape kind. */
  category: AtlasCategory;
  /** Cohort the phantom was projected toward. */
  target: PhantomTargetId;
  /** User centroid at the moment of projection (line-start for the arrow). */
  userCentroid: [number, number, number];
}

export interface ProjectionOptions {
  /** How many phantom points to synthesize. Default 36 — dense enough to read as a swarm. */
  pointCount?: number;
  /**
   * Fraction of the way from user-centroid to a sampled elite point that
   * each phantom lands. 1.0 = sit on the elite cluster, 0.0 = sit on the
   * user centroid. Default 0.92.
   */
  completion?: number;
  /** Position jitter half-width in world units. Default 0.6 — matches the elite spread. */
  jitter?: number;
}

/**
 * Tuned to read as "future / aspirational state" — distinct from the
 * existing palette (none of the cohorts use violet) and carries a soft
 * sci-fi-projection connotation that fits the could-be framing.
 */
const PHANTOM_COLOR = '#a78bfa';
const PHANTOM_CATEGORY_ID = 'user_phantom';

export function projectPhantomTrajectory(
  dataset: AtlasDataset,
  targetId: PhantomTargetId,
  options: ProjectionOptions = {},
): PhantomTrajectory | null {
  const pointCount = options.pointCount ?? 36;
  const completion = options.completion ?? 0.92;
  const jitter = options.jitter ?? 0.6;

  const targetCat = dataset.categories.find(c => c.id === targetId);
  if (!targetCat) return null;

  // Baseline user points = points the user actually has, *before* any
  // logged "training" injections. Injections are themselves a step toward
  // elite; including them would double-count the progress and push the
  // phantom past the elite cluster.
  const userPts = dataset.points.filter(p => {
    if (p.category !== 'user') return false;
    const meta = p.meta as Record<string, unknown> | undefined;
    return meta?.injected !== true;
  });
  if (userPts.length === 0) return null;

  let ux = 0, uy = 0, uz = 0;
  for (const p of userPts) { ux += p.x; uy += p.y; uz += p.z; }
  ux /= userPts.length; uy /= userPts.length; uz /= userPts.length;

  const targetPts = dataset.points.filter(p => p.category === targetId);
  if (targetPts.length === 0) return null;

  const phantoms: AtlasPoint[] = [];
  const now = Date.now();
  for (let i = 0; i < pointCount; i++) {
    const pick = targetPts[Math.floor(Math.random() * targetPts.length)]!;
    // Slight per-point completion wobble so phantoms don't all line up
    // on the same iso-distance shell from the user centroid.
    const t = Math.min(1, Math.max(0, completion + (Math.random() - 0.5) * 0.05));
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    const jz = (Math.random() - 0.5) * jitter;
    phantoms.push({
      id: `phantom-${now}-${i}`,
      x: ux * (1 - t) + pick.x * t + jx,
      y: uy * (1 - t) + pick.y * t + jy,
      z: uz * (1 - t) + pick.z * t + jz,
      category: PHANTOM_CATEGORY_ID,
      label: 'Projected day',
      timestamp: now + i,
      source: 'projected',
      meta: { phantom: true, towards: targetId },
    });
  }

  const shape = pcaClusterShape(phantoms);
  if (!shape) return null;

  const category: AtlasCategory = {
    id: PHANTOM_CATEGORY_ID,
    label: `Could-be · ${targetCat.label}`,
    color: PHANTOM_COLOR,
    // Phantom adopts the *target's* primitive — that's the whole point of
    // the projection: "this is what your shape becomes."
    shape: targetCat.shape ?? 'octahedron',
    position: shape.centroid,
  };

  return {
    points: phantoms,
    shape,
    category,
    target: targetId,
    userCentroid: [ux, uy, uz],
  };
}
