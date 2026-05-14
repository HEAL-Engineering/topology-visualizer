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
import { computeLobeStats, METRIC_KEYS, METRICS, type MetricKey } from './lobe-actions';

export type PhantomTargetId = 'elite_male' | 'elite_female';

/**
 * Feature-space component of a phantom projection: a single metric's gap
 * between the user's current baseline and the chosen elite cohort's actual
 * mean (NOT the hardcoded `MetricInfo.eliteTarget`, which is elite_male-only
 * and would mis-describe an elite_female projection).
 *
 * Surfaced in the UI as a guardrail list — answers the user's "what do I
 * actually need to change to land at this shape" question that the pure
 * geometric projection leaves implicit.
 *
 * Caveat baked into the section copy: feature-space ranking is correlated
 * with but not identical to UMAP geometric contribution. We avoid claiming
 * "this is what produces the shape" — the framing is "this is what the
 * projection assumes you change," which is honest about the correlation.
 */
export interface PhantomComponent {
  key: MetricKey;
  label: string;
  unit: string;
  current: number;
  target: number;
  /** Signed target - current. */
  delta: number;
  /** |delta| / max(|target|, 1) — used for ranking; 1 == fallback. */
  relGap: number;
  direction: 'increase' | 'decrease';
  /** Cohort-aware prescriptive sentence from `MetricInfo.do{Increase,Decrease}`. */
  doSentence: string;
}

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
  /**
   * Ranked feature-space deltas describing the metric composition the
   * projection assumes. Top-N only (default 5) — beyond that the gaps are
   * small and the noise dominates the ranking.
   */
  composition: PhantomComponent[];
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
  /** Max composition entries returned. Default 5. */
  compositionLimit?: number;
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

  const composition = computeComposition(userPts, targetPts, options.compositionLimit ?? 5);

  return {
    points: phantoms,
    shape,
    category,
    target: targetId,
    userCentroid: [ux, uy, uz],
    composition,
  };
}

/**
 * Feature-space composition: per-metric current → cohort-mean target gap,
 * ranked by relative magnitude. The "target" here is the *actual mean of
 * the chosen cohort's points* — not the hardcoded `MetricInfo.eliteTarget`
 * which only describes elite_male.
 *
 * Why both means are derived at runtime:
 *   - Cohort-specific: elite_female mean ≠ elite_male mean for resting HR,
 *     peak HR, and sleep totals; using the hardcoded prior would mis-state
 *     the gap for an elite_female projection.
 *   - User-specific: lobe-actions averages over a single lobe's points; the
 *     phantom needs the user's *overall* baseline (all non-injected user
 *     points) because the projection itself was computed against that
 *     baseline. Mixing scopes here would make the composition disagree with
 *     the geometric arrow it's meant to explain.
 *
 * Why ranked by `|gap| / |target|`:
 *   - Same heuristic as lobe-actions, keeps the two surfaces consistent.
 *   - Pure absolute gap would always foreground `steps` (units are 10⁴)
 *     and bury sleep deltas; relative gap normalizes that.
 *
 * Skipped when a metric is missing in either side — happens for datasets
 * that don't carry the heal-api feature meta (e.g. demo mocks). The UI
 * gracefully shows fewer guardrails rather than zeros.
 */
function computeComposition(
  userPts: readonly AtlasPoint[],
  targetPts: readonly AtlasPoint[],
  limit: number,
): PhantomComponent[] {
  const userMeans = computeLobeStats(userPts);
  const targetMeans = computeLobeStats(targetPts);
  const out: PhantomComponent[] = [];
  for (const key of METRIC_KEYS) {
    const current = userMeans[key];
    const target = targetMeans[key];
    if (current == null || target == null) continue;
    const delta = target - current;
    const denom = Math.abs(target) > 1e-6 ? Math.abs(target) : 1;
    const relGap = Math.abs(delta) / denom;
    const direction: 'increase' | 'decrease' = delta > 0 ? 'increase' : 'decrease';
    const info = METRICS[key];
    out.push({
      key,
      label: info.label,
      unit: info.unit,
      current,
      target,
      delta,
      relGap,
      direction,
      doSentence: direction === 'increase' ? info.doIncrease : info.doDecrease,
    });
  }
  out.sort((a, b) => b.relGap - a.relGap);
  return out.slice(0, limit);
}
