/**
 * Metric registry — biomarker fields the MetricLens panel can project onto
 * the 3D point cloud. Each entry maps the data key (under `meta.biomarkers`
 * on every point) to display label, unit, and the dataset-wide value range
 * used to normalize the heatmap.
 *
 * Ranges are inclusive bounds drawn from the augment-biomarkers cohort
 * distributions; values outside this range get clamped before mapping.
 */

export type MetricDef = {
  /** Path key inside `point.meta.biomarkers`. */
  key: string;
  /** Display label shown in the lens panel and the legend. */
  label: string;
  unit: string;
  /** Min / max values for color normalization across the whole dataset. */
  range: [number, number];
  /** Higher is healthier? Used to align "good" with the warm end of the ramp. */
  higherIsBetter: boolean;
};

export const METRICS: MetricDef[] = [
  { key: 'calories_intake', label: 'Calories intake',  unit: 'kcal/day',  range: [1400, 4000], higherIsBetter: true },
  { key: 'calories_burned', label: 'Calories burned',  unit: 'kcal/day',  range: [200, 1100],  higherIsBetter: true },
  { key: 'workout_min',     label: 'Workout time',     unit: 'min/day',   range: [10, 120],    higherIsBetter: true },
  { key: 'vo2max',          label: 'VO₂ max',          unit: 'ml/kg/min', range: [25, 80],     higherIsBetter: true },
  { key: 'hrv',             label: 'HRV (RMSSD)',      unit: 'ms',        range: [15, 95],     higherIsBetter: true },
  { key: 'resting_hr',      label: 'Resting HR',       unit: 'bpm',       range: [35, 80],     higherIsBetter: false },
];

/** Look up a point's metric value, returning null if the field is absent. */
export function readMetric(point: { meta?: unknown }, key: string): number | null {
  const meta = point.meta as { biomarkers?: Record<string, unknown> } | undefined;
  const raw = meta?.biomarkers?.[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw;
}

/**
 * Normalize a metric value to [0, 1] using its defined range and direction.
 * For "higher is better" metrics (VO₂max), high → 1. For "lower is better"
 * (resting HR), low → 1. The lens shader / color ramp can then treat 1 as
 * "good / hot / bright" without per-metric branching.
 */
export function normalizeMetric(def: MetricDef, value: number): number {
  const [lo, hi] = def.range;
  const t = (value - lo) / (hi - lo);
  const clamped = Math.max(0, Math.min(1, t));
  return def.higherIsBetter ? clamped : 1 - clamped;
}
