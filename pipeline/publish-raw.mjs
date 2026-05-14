#!/usr/bin/env node
/**
 * publish-raw.mjs
 *
 * Reads pipeline/generated_input.json (the full dedup dump that feeds the
 * Python pipeline) and writes public/raw.json with provenance attached:
 * each dedup record gets an `atlas_point_id` field naming the user-day
 * atlas point it contributed to.
 *
 * The mapping is deterministic. The Python pipeline emits one user-day per
 * calendar date, with id = `user-${date}`. So:
 *   - HR records:    atlas_point_id = `user-${start_time.slice(0,10)}`
 *   - Sleep / Steps: atlas_point_id = `user-${date}`
 *
 * This bridges the raw → atlas conversion: every row in the Raw table now
 * carries a pointer to its derived embedding point, and clicking through
 * surfaces the many-to-one collapse the pipeline performs.
 *
 * Run with:
 *   node pipeline/publish-raw.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_PATH  = resolve(HERE, 'generated_input.json');
const OUT_PATH = resolve(HERE, '..', 'public', 'raw.json');

const src = JSON.parse(readFileSync(IN_PATH, 'utf8'));

function atlasIdForDate(date) {
  return `user-${date}`;
}

const dedup_heart_rates = (src.dedup_heart_rates ?? []).map(r => ({
  ...r,
  atlas_point_id: atlasIdForDate(r.start_time.slice(0, 10)),
}));
const dedup_sleep_sessions = (src.dedup_sleep_sessions ?? []).map(r => ({
  ...r,
  atlas_point_id: atlasIdForDate(r.date),
}));
const dedup_daily_steps = (src.dedup_daily_steps ?? []).map(r => ({
  ...r,
  atlas_point_id: atlasIdForDate(r.date),
}));

const out = {
  user_id: src.user_id,
  dedup_heart_rates,
  dedup_sleep_sessions,
  dedup_daily_steps,
};

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

const total = dedup_heart_rates.length + dedup_sleep_sessions.length + dedup_daily_steps.length;
const uniqueIds = new Set([
  ...dedup_heart_rates.map(r => r.atlas_point_id),
  ...dedup_sleep_sessions.map(r => r.atlas_point_id),
  ...dedup_daily_steps.map(r => r.atlas_point_id),
]);

console.log(`Wrote ${OUT_PATH}`);
console.log(`  HR:     ${dedup_heart_rates.length}`);
console.log(`  Sleep:  ${dedup_sleep_sessions.length}`);
console.log(`  Steps:  ${dedup_daily_steps.length}`);
console.log(`  TOTAL:  ${total}`);
console.log(`  Unique atlas_point_id values: ${uniqueIds.size}`);
console.log(`  Many-to-one ratio: ${(total / uniqueIds.size).toFixed(1)} raw records → 1 atlas point`);
