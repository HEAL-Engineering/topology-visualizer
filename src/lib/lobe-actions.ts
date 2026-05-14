/**
 * lobe-actions — generate per-sub-cluster action items from each lobe's
 * own pipeline-derived feature means.
 *
 * Why this exists: a category's static `ARCHETYPE_READING.actions` is the
 * same for every lobe. But two spatially-separated lobes are spatially
 * separated *because* their underlying feature vectors differ — UMAP would
 * have placed them together otherwise. Showing the same advice to both
 * lobes hides exactly the signal that produced the split.
 *
 * Source of truth: the 9 features computed by `pipeline/heal_atlas/
 * featurize.py` and written to `point.meta.*`:
 *   resting_hr, avg_hr, peak_hr, sleep_{deep,rem,light,awake,total}_min, steps
 *
 * These are *real* daily aggregates derived from the raw dedup records, not
 * the synthetic biomarkers under `meta.biomarkers` (which augment-biomarkers
 * writes per-category for the metric lens). The pipeline features genuinely
 * differ between lobes; the lens biomarkers don't. Using these as the
 * source for advice means the two lobes get different action items, which
 * is the whole point.
 *
 * Targets are pulled from `pipeline/heal_atlas/cohorts.py` COHORT_PRIORS
 * for elite_male — the morph destination this app encourages.
 */

import type { AtlasPoint } from '../schema/types';

const METRIC_KEYS = [
  'resting_hr',
  'peak_hr',
  'sleep_deep_min',
  'sleep_rem_min',
  'sleep_total_min',
  'steps',
] as const;

type MetricKey = typeof METRIC_KEYS[number];

interface MetricInfo {
  label: string;
  unit: string;
  /** elite_male mean from cohorts.py COHORT_PRIORS. */
  eliteTarget: number;
  /** Sentence prescribing how to move the metric toward the elite end. */
  doIncrease: string;
  /** Sentence prescribing how to move the metric toward the elite end when
   *  the elite end is *lower* than this lobe's current value. */
  doDecrease: string;
}

const METRICS: Record<MetricKey, MetricInfo> = {
  resting_hr: {
    label: 'Resting HR',
    unit: 'bpm',
    eliteTarget: 45,
    doIncrease:
      'Resting HR is below the elite-male prior — schedule a cardiology check before adding training volume.',
    doDecrease:
      'Drop resting HR with 3 zone-2 cardio sessions/week (45–60 min, conversational pace). Expect 5–10 bpm over 8–12 weeks of consistent aerobic base work.',
  },
  peak_hr: {
    label: 'Peak HR',
    unit: 'bpm',
    eliteTarget: 185,
    doIncrease:
      'Add one high-intensity session/week: 4×4 min at 90–95% HRmax with 3 min recovery, or 30-30s repeats. Pushes peak HR ceiling and VO₂max together.',
    doDecrease:
      'Peak is already elite-range — protect by holding the interval frequency at 1×/week and prioritize recovery the day after.',
  },
  sleep_deep_min: {
    label: 'Deep sleep',
    unit: 'min/night',
    eliteTarget: 95,
    doIncrease:
      'Deep sleep responds to cool room (60–67°F), 0 alcohol in the 3 hr before bed, and magnesium glycinate (300–400 mg evenings). Earlier dinner — late carbs blunt slow-wave activity.',
    doDecrease:
      'Already at elite-range deep sleep — maintain the routine that produced it.',
  },
  sleep_rem_min: {
    label: 'REM sleep',
    unit: 'min/night',
    eliteTarget: 120,
    doIncrease:
      'REM sits later in the night — getting more REM means lengthening total sleep, not just changing onset. Push lights-out 30 min earlier; protect the last cycle by holding wake time constant.',
    doDecrease:
      'REM is already in elite territory — protect by holding a consistent wake time within 30 min daily.',
  },
  sleep_total_min: {
    label: 'Total sleep',
    unit: 'min/night',
    eliteTarget: 480,
    doIncrease:
      'Add 30–45 min of total sleep by moving lights-out earlier, not wake-up later. Eliminate screens 60 min pre-bed; bedroom dark + 65°F.',
    doDecrease:
      'Above the elite-male target — well within the 7.5–9 hr healthy range, no action needed.',
  },
  steps: {
    label: 'Daily steps',
    unit: 'steps',
    eliteTarget: 14500,
    doIncrease:
      'Lift NEAT by 30–50%: take walking meetings, 10-min loops between work blocks, stand-desk 2+ hrs/day. Aim for 12k+ steps daily; gradual ramp avoids overuse.',
    doDecrease:
      'Step count is already at or above the elite-male prior. Sustain it.',
  },
};

/** Per-lobe mean of each tracked metric (null if no points carry the field). */
export type LobeStats = Record<MetricKey, number | null>;

export function computeLobeStats(points: readonly AtlasPoint[]): LobeStats {
  const sums: Record<MetricKey, number> = {
    resting_hr: 0, peak_hr: 0,
    sleep_deep_min: 0, sleep_rem_min: 0, sleep_total_min: 0,
    steps: 0,
  };
  const counts: Record<MetricKey, number> = {
    resting_hr: 0, peak_hr: 0,
    sleep_deep_min: 0, sleep_rem_min: 0, sleep_total_min: 0,
    steps: 0,
  };
  for (const p of points) {
    const meta = p.meta as Record<string, unknown> | undefined;
    if (!meta) continue;
    for (const k of METRIC_KEYS) {
      const v = meta[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        sums[k] += v;
        counts[k]++;
      }
    }
  }
  const out: LobeStats = {
    resting_hr: null, peak_hr: null,
    sleep_deep_min: null, sleep_rem_min: null, sleep_total_min: null,
    steps: null,
  };
  for (const k of METRIC_KEYS) {
    out[k] = counts[k] > 0 ? sums[k] / counts[k] : null;
  }
  return out;
}

export interface LobeAction {
  from: string;
  do: string;
}

/**
 * Produce up to `maxItems` action items, ranked by relative gap between
 * this lobe's mean and the elite target. The `from` field always includes
 * the lobe's actual mean so two lobes of the same category emit visibly-
 * different advice — the whole point of per-lobe actions.
 */
export function generateLobeActions(
  points: readonly AtlasPoint[],
  maxItems = 5,
): LobeAction[] {
  const stats = computeLobeStats(points);
  type GapEntry = {
    key: MetricKey;
    current: number;
    rawGap: number;     // signed, target - current
    relGap: number;     // |rawGap| / target — used for ranking
  };
  const entries: GapEntry[] = [];
  for (const k of METRIC_KEYS) {
    const m = stats[k];
    if (m == null) continue;
    const target = METRICS[k].eliteTarget;
    if (target === 0) continue;
    const rawGap = target - m;
    entries.push({
      key: k,
      current: m,
      rawGap,
      relGap: Math.abs(rawGap) / target,
    });
  }
  entries.sort((a, b) => b.relGap - a.relGap);

  return entries.slice(0, maxItems).map(e => {
    const info = METRICS[e.key];
    // rawGap > 0  →  target sits above current  →  need to INCREASE.
    // rawGap < 0  →  target sits below current  →  need to DECREASE.
    // For resting_hr the elite target (45) is below typical current (~58),
    // so rawGap is negative → DECREASE advice ("more zone-2 to lower").
    const direction: 'increase' | 'decrease' = e.rawGap > 0 ? 'increase' : 'decrease';
    const fmtCurrent = formatValue(e.current);
    const fmtTarget = formatValue(info.eliteTarget);
    const gapWord = direction === 'increase' ? 'below' : 'above';
    const gapMag = formatValue(Math.abs(e.rawGap));
    return {
      from: `${info.label}: ${fmtCurrent} ${info.unit} · ${gapMag} ${gapWord} elite target (${fmtTarget})`,
      do: direction === 'increase' ? info.doIncrease : info.doDecrease,
    };
  });
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  if (Math.abs(v) >= 10) return Math.round(v).toString();
  return v.toFixed(1);
}
