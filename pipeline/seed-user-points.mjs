#!/usr/bin/env node
/**
 * seed-user-points.mjs
 *
 * Seeds public/atlas.json with N synthetic user-category points whose 3D
 * distribution mirrors the avg_male cohort's ellipsoidal topology — same
 * covariance shape, but centered on the existing user-category centroid.
 *
 * The result: the user cluster reads as a coherent ellipsoid (rather than
 * 3 sparse outliers) and starts visually in the "avg_male shape" basin,
 * which is the natural baseline for the morph-toward-elite training UX.
 *
 * Each seeded point carries `meta.seed: true`. The MorphTarget reset path
 * only purges `meta.injected: true`, so reseting morph progress does not
 * wipe this baseline.
 *
 * Idempotent: rerunning strips prior seeded points before writing new ones.
 * Run with:  node pipeline/seed-user-points.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ATLAS_PATH = resolve(HERE, '..', 'public', 'atlas.json');

const SEED_COUNT = 80;
/** Anchor date the existing user points end at — we seed dates backwards from here. */
const ANCHOR_DATE_MS = Date.parse('2026-03-31T00:00:00Z');
const DAY_MS = 86_400_000;

/** Mulberry32 — deterministic PRNG so seed runs are reproducible. */
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

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function gauss(rng) {
  // Box-Muller, single output. Used for the lightweight biomarker noise.
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const atlasText = readFileSync(ATLAS_PATH, 'utf8');
const atlas = JSON.parse(atlasText);

// Strip any prior seeded user points so reruns are idempotent.
atlas.points = atlas.points.filter(p => {
  const meta = p.meta;
  return !(p.category === 'user' && meta && meta.seed === true);
});

const userPoints = atlas.points.filter(p => p.category === 'user');
const avgMalePoints = atlas.points.filter(p => p.category === 'avg_male');

if (avgMalePoints.length === 0) {
  console.error('No avg_male points to source covariance from — aborting.');
  process.exit(1);
}

// Centroid of the existing user points = anchor for the new cluster.
let ux = 0, uy = 0, uz = 0;
for (const p of userPoints) { ux += p.x; uy += p.y; uz += p.z; }
const userCentroid = userPoints.length
  ? [ux / userPoints.length, uy / userPoints.length, uz / userPoints.length]
  : [4.078, 12.932, 4.960];

// Mean of avg_male — used to convert each avg_male point into a deviation
// vector we can re-anchor at the user centroid. Sampling deviations directly
// reproduces avg_male's covariance shape (including any anisotropy and
// off-diagonal correlations) without an explicit covariance / Cholesky.
let mx = 0, my = 0, mz = 0;
for (const p of avgMalePoints) { mx += p.x; my += p.y; mz += p.z; }
mx /= avgMalePoints.length;
my /= avgMalePoints.length;
mz /= avgMalePoints.length;

const rng = makeRng(20260513);

const newPoints = [];
for (let i = 0; i < SEED_COUNT; i++) {
  // Random avg_male point → deviation from avg_male centroid → re-anchor.
  const src = avgMalePoints[Math.floor(rng() * avgMalePoints.length)];
  const dx = src.x - mx;
  const dy = src.y - my;
  const dz = src.z - mz;
  // Tiny extra jitter so points don't perfectly mirror avg_male's set.
  const jx = gauss(rng) * 0.05;
  const jy = gauss(rng) * 0.05;
  const jz = gauss(rng) * 0.05;

  // Seed dates: one per day back from anchor. Keeps a continuous calendar
  // so the table sort by timestamp produces a coherent timeline.
  const ts = ANCHOR_DATE_MS - (i + 1) * DAY_MS;

  // Wheel-of-Wellness sub-scores: anchor mid-range (5–7) with noise; the
  // user prototype straddles average and elite, so values cluster around 6.
  const dim = () => clamp(6 + gauss(rng) * 1.6, 0, 10);
  const physical = dim();
  const emotional = dim();
  const intellectual = dim();
  const social = dim();
  const spiritual = dim();
  const occupational = dim();
  const financial = dim();
  const environmental = dim();
  const composite =
    (physical + emotional + intellectual + social +
     spiritual + occupational + financial + environmental) / 8;

  // Lightweight synthetic biomarkers — within healthy adult ranges,
  // correlated loosely with the composite score.
  const fitFactor = clamp(composite / 10, 0, 1);
  const resting_hr = Math.round(72 - fitFactor * 18 + gauss(rng) * 3);
  const avg_hr = Math.round(resting_hr + 8 + gauss(rng) * 4);
  const peak_hr = Math.round(avg_hr + 8 + gauss(rng) * 5);
  const sleep_total_min = Math.round(430 + gauss(rng) * 35);
  const sleep_deep_min = Math.round(clamp(sleep_total_min * 0.18 + gauss(rng) * 8, 40, 140));
  const sleep_rem_min = Math.round(clamp(sleep_total_min * 0.22 + gauss(rng) * 10, 40, 160));
  const sleep_awake_min = Math.round(clamp(15 + gauss(rng) * 6, 0, 60));
  const sleep_light_min = clamp(sleep_total_min - sleep_deep_min - sleep_rem_min - sleep_awake_min, 0, sleep_total_min);
  const steps = Math.round(clamp(8500 + fitFactor * 3500 + gauss(rng) * 1500, 1000, 22000));

  const idTail = randomBytes(2).toString('hex');
  newPoints.push({
    id: `user-seed-${isoDate(ts)}-${idTail}`,
    x: userCentroid[0] + dx + jx,
    y: userCentroid[1] + dy + jy,
    z: userCentroid[2] + dz + jz,
    category: 'user',
    label: isoDate(ts),
    value: Number(composite.toFixed(4)),
    unit: 'wellness score',
    timestamp: ts,
    source: 'mock_seed',
    userId: '00000000-0000-0000-0000-000000000007',
    meta: {
      seed: true,
      physical, emotional, intellectual, social,
      spiritual, occupational, financial, environmental,
      wellness_composite: composite,
      biomarkers: {
        resting_hr, avg_hr, peak_hr,
        sleep_deep_min, sleep_rem_min, sleep_light_min, sleep_awake_min,
        sleep_total_min, steps,
      },
      source_presence: {
        email: rng() > 0.2,
        messages: rng() > 0.15,
        wearable: rng() > 0.05,
        financial: rng() > 0.4,
      },
    },
  });
}

atlas.points.push(...newPoints);

writeFileSync(ATLAS_PATH, JSON.stringify(atlas, null, 2));

console.log(`Seeded ${newPoints.length} user points around centroid [${userCentroid.map(v => v.toFixed(3)).join(', ')}]`);
console.log(`Total points now: ${atlas.points.length}`);
console.log(`User points now: ${atlas.points.filter(p => p.category === 'user').length}`);
