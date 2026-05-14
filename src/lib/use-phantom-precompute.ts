/**
 * usePhantomPrecompute — fire-and-forget background generator that fills
 * `phantomCache` with a trajectory for every (user, elite-target) combo
 * the moment a dataset finishes loading. Components that consume the
 * cache (`PhantomSection`, `PhantomTrajectory`) can then show / switch
 * instantly without paying for the random sample on user interaction.
 *
 * Why deferred via `setTimeout(0)` instead of synchronous in the effect:
 *   - The projection itself is cheap (~36 points, O(N) math), but we want
 *     `phantomLoading[key] = true` to actually render *before* the work
 *     runs so the spinner in PhantomSection has a chance to paint. A sync
 *     call would flip loading on and off inside the same React batch and
 *     the user would never see the indicator.
 *   - It also keeps the dataset-load effect non-blocking: if more elite
 *     targets are added later, the loop won't budget into the initial
 *     paint of the page.
 *
 * Cancellation:
 *   When the dataset reference swaps (file reload, dataset replaced)
 *   the in-flight setTimeouts capture the old dataset and would otherwise
 *   cache stale trajectories. `cancelled` plus `clearTimeout` makes those
 *   no-ops; the new effect run kicks off a fresh batch.
 */
import { useEffect } from 'react';
import { useAtlasStore } from '../store';
import { projectPhantomTrajectory, type PhantomTargetId } from './phantom-trajectory';

const USER_CATEGORY_ID = 'user';
const PRECOMPUTE_TARGETS: PhantomTargetId[] = ['elite_male', 'elite_female'];

/** Stable cache key for a (user-category, elite-target) pair. */
export function phantomCacheKey(userId: string, target: PhantomTargetId): string {
  return `${userId}::${target}`;
}

export function usePhantomPrecompute(): void {
  const dataset = useAtlasStore(s => s.dataset);
  const setCacheEntry = useAtlasStore(s => s.setPhantomCacheEntry);
  const setLoading = useAtlasStore(s => s.setPhantomLoading);
  const clearCache = useAtlasStore(s => s.clearPhantomCache);

  useEffect(() => {
    if (!dataset) return;

    // Dataset has fully swapped — drop any previously cached projections
    // before kicking off fresh ones. Without this, switching datasets
    // would render trajectories sampled from the wrong elite cluster.
    clearCache();

    // Skip work when the necessary categories aren't present (e.g. a
    // custom dataset without elite cohorts). The PhantomSection UI will
    // then just stay in its "no projection available" state.
    const hasUser = dataset.categories.some(c => c.id === USER_CATEGORY_ID);
    if (!hasUser) return;
    const targets = PRECOMPUTE_TARGETS.filter(t => dataset.categories.some(c => c.id === t));
    if (targets.length === 0) return;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    for (const target of targets) {
      const key = phantomCacheKey(USER_CATEGORY_ID, target);
      setLoading(key, true);
      const tid = setTimeout(() => {
        if (cancelled) return;
        try {
          const traj = projectPhantomTrajectory(dataset, target);
          if (traj && !cancelled) setCacheEntry(key, traj);
        } finally {
          if (!cancelled) setLoading(key, false);
        }
      }, 0);
      timeouts.push(tid);
    }

    return () => {
      cancelled = true;
      for (const tid of timeouts) clearTimeout(tid);
    };
  }, [dataset, setCacheEntry, setLoading, clearCache]);
}
