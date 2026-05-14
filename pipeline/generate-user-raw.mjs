#!/usr/bin/env node
/**
 * generate-user-raw.mjs
 *
 * Emits a heal-api-shaped JSON dump (user_id + dedup_heart_rates +
 * dedup_sleep_sessions + dedup_daily_steps) covering N consecutive days,
 * sized to produce N user-day atlas points when fed through the real
 * Python pipeline (heal-atlas).
 *
 * Goal: replace the seed-user-points shortcut. The pipeline does its own
 * featurization + UMAP transform, so positions in the resulting atlas.json
 * are *derived from these dedup records*, not pre-baked 3D coordinates.
 *
 * Sample means (one row per day) sit between avg_male and elite_male on
 * the 9 pipeline features (see cohorts.py FEATURES) — produces a user
 * cluster that lives in the corridor between average and elite, matching
 * the "trending toward elite" narrative the InspectPanel encodes.
 *
 * Run:
 *   node pipeline/generate-user-raw.mjs            # writes pipeline/generated_input.json
 *   node pipeline/generate-user-raw.mjs --days 120 # custom day count
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, 'generated_input.json');

const argv = process.argv.slice(2);
const daysArg = argv.indexOf('--days');
const N_DAYS = daysArg >= 0 ? Number(argv[daysArg + 1]) : 80;
const START_DATE = '2024-05-01';
const USER_ID = 7;
const SEED = 20260515;

/**
 * Per-day means for the 9 FEATURES — matched to the `avg_male` cohort prior
 * in cohorts.py. Sitting the user-day distribution inside the avg_male
 * region of the wearable feature space makes UMAP project these days into
 * a single tight lobe near the avg_male cluster, instead of straddling
 * the avg→elite corridor and producing two disjoint lobes the way an
 * "between cohorts" mean did.
 *
 * To shift the user toward another cohort later, copy that cohort's
 * `mean` row from cohorts.py COHORT_PRIORS into this object.
 */
const MEANS = {
  resting_hr:       70,
  avg_hr:           80,
  peak_hr:         135,
  sleep_deep_min:   60,
  sleep_rem_min:    90,
  sleep_light_min: 250,
  sleep_awake_min:  20,
  steps:          5300,
};

/**
 * Per-feature σ — half of avg_male's cohort σ. Tight enough that all 80
 * user-days project into a single coherent lobe (so the sub-cluster
 * splitter doesn't see a gap), wide enough that the cluster reads as an
 * ellipsoid rather than a point.
 */
const SIGMAS = {
  resting_hr:       4,
  avg_hr:           4,
  peak_hr:          7,
  sleep_deep_min:   7,
  sleep_rem_min:   10,
  sleep_light_min: 17,
  sleep_awake_min:  4,
  steps:          900,
};

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

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const rng = makeRng(SEED);
const heart_rates = [];
const sleep_sessions = [];
const daily_steps = [];

const start = new Date(START_DATE + 'T00:00:00Z');

for (let i = 0; i < N_DAYS; i++) {
  const d = new Date(start.getTime() + i * 86_400_000);
  const date = isoDate(d);

  // Sample today's per-day vector. Floor at safe physiological minimums.
  const restingHr = Math.max(40, Math.round(MEANS.resting_hr + gauss(rng) * SIGMAS.resting_hr));
  const avgHr     = Math.max(restingHr + 4, Math.round(MEANS.avg_hr + gauss(rng) * SIGMAS.avg_hr));
  const peakHr    = Math.max(avgHr + 10, Math.round(MEANS.peak_hr + gauss(rng) * SIGMAS.peak_hr));
  const deep      = Math.max(20, Math.round(MEANS.sleep_deep_min + gauss(rng) * SIGMAS.sleep_deep_min));
  const rem       = Math.max(30, Math.round(MEANS.sleep_rem_min + gauss(rng) * SIGMAS.sleep_rem_min));
  const light     = Math.max(120, Math.round(MEANS.sleep_light_min + gauss(rng) * SIGMAS.sleep_light_min));
  const awake     = Math.max(0, Math.round(MEANS.sleep_awake_min + gauss(rng) * SIGMAS.sleep_awake_min));
  const steps     = Math.max(0, Math.round(MEANS.steps + gauss(rng) * SIGMAS.steps));

  // One HR record per day at the morning window. featurize uses min(min_bpm),
  // mean(avg_bpm), max(max_bpm) over the day's records — one record is
  // sufficient to populate all three aggregates correctly.
  heart_rates.push({
    user_id: USER_ID,
    source: 'apple_health',
    max_bpm: peakHr,
    min_bpm: restingHr,
    avg_bpm: avgHr,
    start_time: `${date}T07:00:00Z`,
    end_time:   `${date}T09:00:00Z`,
  });

  // Four sleep stage rows per day. stage_type → name in featurize:
  //   1 = light, 2 = deep, 3 = rem, 4 = awake
  sleep_sessions.push(
    { user_id: USER_ID, date, stage_type: 2, duration_minutes: deep,  source: 'oura' },
    { user_id: USER_ID, date, stage_type: 3, duration_minutes: rem,   source: 'oura' },
    { user_id: USER_ID, date, stage_type: 1, duration_minutes: light, source: 'oura' },
    { user_id: USER_ID, date, stage_type: 4, duration_minutes: awake, source: 'oura' },
  );

  daily_steps.push({
    user_id: USER_ID,
    date,
    steps,
    source: 'fitbit',
  });
}

const payload = {
  user_id: USER_ID,
  dedup_heart_rates: heart_rates,
  dedup_sleep_sessions: sleep_sessions,
  dedup_daily_steps: daily_steps,
};

writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));

console.log(`Generated ${N_DAYS} days of dedup data for user ${USER_ID}.`);
console.log(`  heart_rates    : ${heart_rates.length}`);
console.log(`  sleep_sessions : ${sleep_sessions.length}`);
console.log(`  daily_steps    : ${daily_steps.length}`);
console.log(`Wrote ${OUT_PATH}`);
console.log('');
console.log('Next:');
console.log('  cd pipeline && uv sync                                          # one-time');
console.log('  cd pipeline && uv run heal-atlas generated_input.json ../public/atlas.json');
console.log('  node pipeline/augment-biomarkers.mjs                            # adds lens metrics');
