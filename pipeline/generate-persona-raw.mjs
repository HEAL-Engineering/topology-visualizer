#!/usr/bin/env node
/**
 * generate-persona-raw.mjs
 *
 * Emits a heal-api-shaped JSON dump (user_id + dedup_heart_rates +
 * dedup_sleep_sessions + dedup_daily_steps) covering N consecutive days
 * for a chosen demographic persona. Output drops into the existing
 * pipeline (`uv run heal-atlas ... atlas.json`) and lands the user
 * cluster on the cohort it was sampled from.
 *
 * Personas (matched to cohorts.COHORT_PRIORS — sources in DESIGN.md §4):
 *   avg_male       US adult male (Apple Heart Study + Garmin sleep + Bassett steps)
 *   avg_female     US adult female (same provenance, female cuts)
 *   elite_male     elite endurance male (Topend Sports RHR + sports-med sleep)
 *   elite_female   elite endurance female
 *
 * Usage:
 *   node pipeline/generate-persona-raw.mjs avg_male                # default 80 days, writes pipeline/persona-avg_male.json
 *   node pipeline/generate-persona-raw.mjs avg_female --days 30
 *   node pipeline/generate-persona-raw.mjs elite_male --out custom.json
 *   node pipeline/generate-persona-raw.mjs --all                   # emits all four personas
 *
 * Next step after generating:
 *   cd pipeline && uv run heal-atlas persona-avg_male.json ../public/atlas.json
 *   node pipeline/augment-biomarkers.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const START_DATE = '2024-05-01';
const USER_IDS = { avg_male: 101, avg_female: 102, elite_male: 103, elite_female: 104 };

// Mirrors pipeline/heal_atlas/cohorts.py COHORT_PRIORS (May 2026 scrape).
// Order: [resting_hr, avg_hr, peak_hr, sleep_deep, sleep_rem, sleep_light, sleep_awake, sleep_total, steps]
// sleep_total is ignored here (derived from stages); kept for parity.
const PERSONAS = {
  avg_male: {
    mean: { resting_hr: 66, avg_hr: 80, peak_hr: 165, sleep_deep_min: 67, sleep_rem_min: 82, sleep_light_min: 275, sleep_awake_min: 24, steps: 5340 },
    // σ is half the cohort prior σ — tight enough for a coherent cluster,
    // wide enough that points read as an ellipsoid rather than a dot.
    sigma: { resting_hr: 4, avg_hr: 5, peak_hr: 9, sleep_deep_min: 7, sleep_rem_min: 9, sleep_light_min: 18, sleep_awake_min: 4, steps: 900 },
  },
  avg_female: {
    mean: { resting_hr: 68, avg_hr: 83, peak_hr: 163, sleep_deep_min: 71, sleep_rem_min: 92, sleep_light_min: 292, sleep_awake_min: 24, steps: 4912 },
    sigma: { resting_hr: 5, avg_hr: 5, peak_hr: 8, sleep_deep_min: 8, sleep_rem_min: 10, sleep_light_min: 19, sleep_awake_min: 5, steps: 850 },
  },
  elite_male: {
    mean: { resting_hr: 40, avg_hr: 70, peak_hr: 190, sleep_deep_min: 95, sleep_rem_min: 130, sleep_light_min: 280, sleep_awake_min: 15, steps: 15000 },
    sigma: { resting_hr: 3, avg_hr: 4, peak_hr: 6, sleep_deep_min: 9, sleep_rem_min: 11, sleep_light_min: 16, sleep_awake_min: 3, steps: 1800 },
  },
  elite_female: {
    mean: { resting_hr: 44, avg_hr: 72, peak_hr: 188, sleep_deep_min: 100, sleep_rem_min: 130, sleep_light_min: 280, sleep_awake_min: 15, steps: 14000 },
    sigma: { resting_hr: 3, avg_hr: 5, peak_hr: 6, sleep_deep_min: 10, sleep_rem_min: 11, sleep_light_min: 16, sleep_awake_min: 3, steps: 1700 },
  },
};

const PERSONA_SEEDS = { avg_male: 20260518, avg_female: 20260519, elite_male: 20260520, elite_female: 20260521 };

function parseArgs(argv) {
  const args = { persona: null, days: 80, out: null, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--all') args.all = true;
    else if (!a.startsWith('--')) args.persona = a;
  }
  return args;
}

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

function generate(personaName, nDays) {
  const persona = PERSONAS[personaName];
  if (!persona) throw new Error(`Unknown persona "${personaName}". Try one of: ${Object.keys(PERSONAS).join(', ')}`);

  const userId = USER_IDS[personaName];
  const rng = makeRng(PERSONA_SEEDS[personaName]);
  const heart_rates = [];
  const sleep_sessions = [];
  const daily_steps = [];

  const start = new Date(START_DATE + 'T00:00:00Z');
  const { mean, sigma } = persona;

  for (let i = 0; i < nDays; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const date = isoDate(d);

    // Safe physiological floors prevent rare bottom-tail draws from going
    // unphysical (e.g. RHR < 30, peak < avg + 10).
    const restingHr = Math.max(30, Math.round(mean.resting_hr + gauss(rng) * sigma.resting_hr));
    const avgHr     = Math.max(restingHr + 4, Math.round(mean.avg_hr + gauss(rng) * sigma.avg_hr));
    const peakHr    = Math.max(avgHr + 15, Math.round(mean.peak_hr + gauss(rng) * sigma.peak_hr));
    const deep      = Math.max(15, Math.round(mean.sleep_deep_min + gauss(rng) * sigma.sleep_deep_min));
    const rem       = Math.max(25, Math.round(mean.sleep_rem_min + gauss(rng) * sigma.sleep_rem_min));
    const light     = Math.max(120, Math.round(mean.sleep_light_min + gauss(rng) * sigma.sleep_light_min));
    const awake     = Math.max(0, Math.round(mean.sleep_awake_min + gauss(rng) * sigma.sleep_awake_min));
    const steps     = Math.max(0, Math.round(mean.steps + gauss(rng) * sigma.steps));

    heart_rates.push({
      user_id: userId,
      source: 'apple_health',
      max_bpm: peakHr,
      min_bpm: restingHr,
      avg_bpm: avgHr,
      start_time: `${date}T07:00:00Z`,
      end_time:   `${date}T09:00:00Z`,
    });

    // stage_type: 1 = light, 2 = deep, 3 = rem, 4 = awake (per featurize.SLEEP_STAGE_NAMES)
    sleep_sessions.push(
      { user_id: userId, date, stage_type: 2, duration_minutes: deep,  source: 'garmin' },
      { user_id: userId, date, stage_type: 3, duration_minutes: rem,   source: 'garmin' },
      { user_id: userId, date, stage_type: 1, duration_minutes: light, source: 'garmin' },
      { user_id: userId, date, stage_type: 4, duration_minutes: awake, source: 'garmin' },
    );

    daily_steps.push({
      user_id: userId,
      date,
      steps,
      source: 'garmin',
    });
  }

  return {
    user_id: userId,
    dedup_heart_rates: heart_rates,
    dedup_sleep_sessions: sleep_sessions,
    dedup_daily_steps: daily_steps,
  };
}

function writePersona(personaName, nDays, outPath) {
  const payload = generate(personaName, nDays);
  const target = outPath ?? resolve(HERE, `persona-${personaName}.json`);
  writeFileSync(target, JSON.stringify(payload, null, 2));
  console.log(`[${personaName}] ${nDays} days → ${target}`);
  console.log(`  heart_rates    : ${payload.dedup_heart_rates.length}`);
  console.log(`  sleep_sessions : ${payload.dedup_sleep_sessions.length}`);
  console.log(`  daily_steps    : ${payload.dedup_daily_steps.length}`);
}

const args = parseArgs(process.argv.slice(2));

if (args.all) {
  for (const name of Object.keys(PERSONAS)) {
    writePersona(name, args.days, null);
  }
} else if (args.persona) {
  writePersona(args.persona, args.days, args.out);
} else {
  console.error('Usage: node pipeline/generate-persona-raw.mjs <persona> [--days N] [--out path]');
  console.error('       node pipeline/generate-persona-raw.mjs --all [--days N]');
  console.error(`Personas: ${Object.keys(PERSONAS).join(', ')}`);
  process.exit(1);
}

console.log('');
console.log('Next:');
console.log('  cd pipeline && uv run heal-atlas persona-avg_male.json ../public/atlas.json');
console.log('  node pipeline/augment-biomarkers.mjs');
