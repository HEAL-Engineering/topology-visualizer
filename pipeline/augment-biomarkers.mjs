#!/usr/bin/env node
/**
 * augment-biomarkers.mjs
 *
 * Adds the six biomarker fields the MetricLens UI projects onto points,
 * sampled per-cohort around the prototype signatures used by MorphTarget:
 *
 *   calories_intake  (kcal / day)
 *   calories_burned  (kcal / day)
 *   workout_min      (min  / day)
 *   vo2max           (ml O2 / kg / min)
 *   hrv              (ms RMSSD)
 *   resting_hr       (bpm)
 *
 * Every point gets these on `meta.biomarkers.*`. Values are sampled from a
 * gaussian centered at the cohort mean with σ ≈ 8 % of mean — daily noise
 * sufficient to spread the lens heatmap, narrow enough to keep the cohorts
 * visibly different on the same scale.
 *
 * Idempotent: rerunning overwrites these six fields. Other biomarker fields
 * already present on user points (sleep stages, steps, heart rates) are
 * preserved.
 *
 * Run with:  node pipeline/augment-biomarkers.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ATLAS_PATH = resolve(HERE, '..', 'public', 'atlas.json');

/**
 * Cohort prototype signatures. Weekly MorphTarget figures converted to
 * daily values (÷7) so all six metrics share a per-day basis.
 */
const COHORT_MEANS = {
  avg_male:     { calories_intake: 2400, calories_burned: 2500/7, workout_min: (3*60)/7,  vo2max: 38, hrv: 35, resting_hr: 65 },
  avg_female:   { calories_intake: 1900, calories_burned: 2100/7, workout_min: (2.5*60)/7,vo2max: 34, hrv: 40, resting_hr: 68 },
  elite_male:   { calories_intake: 3200, calories_burned: 6000/7, workout_min: (10*60)/7, vo2max: 62, hrv: 75, resting_hr: 48 },
  elite_female: { calories_intake: 2800, calories_burned: 5200/7, workout_min: (9*60)/7,  vo2max: 56, hrv: 70, resting_hr: 52 },
  user:         { calories_intake: 2500, calories_burned: 3200/7, workout_min: (5*60)/7,  vo2max: 44, hrv: 50, resting_hr: 58 },
};

const SIGMA_FRACTION = 0.08;

/** Mulberry32 — deterministic PRNG so reruns produce identical augmentation. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const atlas = JSON.parse(readFileSync(ATLAS_PATH, 'utf8'));
const rng = makeRng(20260514);

let augmented = 0;
let skipped = 0;

for (const p of atlas.points) {
  const means = COHORT_MEANS[p.category];
  if (!means) { skipped++; continue; }

  if (!p.meta) p.meta = {};
  if (!p.meta.biomarkers) p.meta.biomarkers = {};

  for (const [key, mean] of Object.entries(means)) {
    const sigma = mean * SIGMA_FRACTION;
    let v = mean + gauss(rng) * sigma;
    // Reasonable physiological floors — keep noise from going negative on
    // small-mean metrics (workout_min in particular).
    if (key === 'vo2max') v = Math.max(20, v);
    else if (key === 'hrv') v = Math.max(10, v);
    else if (key === 'resting_hr') v = Math.max(35, v);
    else v = Math.max(0, v);
    // 1-decimal precision is enough for a visual lens; keeps file size sane.
    p.meta.biomarkers[key] = Number(v.toFixed(1));
  }
  augmented++;
}

writeFileSync(ATLAS_PATH, JSON.stringify(atlas, null, 2));

console.log(`Augmented ${augmented} points with 6 biomarkers each.`);
if (skipped) console.log(`Skipped ${skipped} points (unknown category).`);
console.log(`Atlas written: ${ATLAS_PATH}`);
