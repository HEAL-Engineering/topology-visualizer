#!/usr/bin/env node
/**
 * publish-raw.mjs
 *
 * Builds public/raw.json — the data the UI Raw tab reads.
 *
 * Two modes:
 *
 * 1. SINGLE (default, legacy): reads pipeline/generated_input.json (one
 *    user's dedup dump) and emits the same shape with an `atlas_point_id`
 *    field added to every record, naming the user-day atlas point each
 *    record contributed to.
 *
 *    node pipeline/publish-raw.mjs
 *
 * 2. PERSONAS: reads pipeline/persona-*.json (one file per cohort —
 *    avg_male, avg_female, elite_male, elite_female) and emits a
 *    multi-user `{users: [...]}` bundle. The persona named in --active
 *    is published as user_id="user" with atlas_point_id=user-<date> links
 *    (since it IS the user cluster in atlas.json). The other three
 *    personas are included as cohort exemplars (no atlas_point_id — the
 *    cohort atlas points are independently sampled by Python and don't
 *    correspond 1:1 to these records).
 *
 *    node pipeline/publish-raw.mjs --personas --active avg_male
 *
 * The bridge is the same in both modes: every row in the Raw table for
 * the user persona carries a pointer to its derived embedding point,
 * showing the many-to-one raw→atlas collapse.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '..', 'public', 'raw.json');
const PERSONA_NAMES = ['avg_male', 'avg_female', 'elite_male', 'elite_female'];

function parseArgs(argv) {
  const args = { personas: false, active: 'avg_male', input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--personas') args.personas = true;
    else if (a === '--active') args.active = argv[++i];
    else if (a === '--input') args.input = argv[++i];
  }
  return args;
}

function atlasIdForDate(date) {
  return `user-${date}`;
}

function tagAsUser(src) {
  // Records that map to actual user-* atlas points — clickable provenance.
  return {
    user_id: 'user',
    dedup_heart_rates: (src.dedup_heart_rates ?? []).map(r => ({
      ...r,
      atlas_point_id: atlasIdForDate(r.start_time.slice(0, 10)),
    })),
    dedup_sleep_sessions: (src.dedup_sleep_sessions ?? []).map(r => ({
      ...r,
      atlas_point_id: atlasIdForDate(r.date),
    })),
    dedup_daily_steps: (src.dedup_daily_steps ?? []).map(r => ({
      ...r,
      atlas_point_id: atlasIdForDate(r.date),
    })),
  };
}

function tagAsCohort(src, personaName) {
  // Records exposed for inspection only — the matching cohort atlas points
  // come from Python's independent Gaussian sampling, so there's no honest
  // 1:1 link. atlas_point_id is intentionally omitted; the UI will render
  // the records but skip the provenance link.
  return {
    user_id: personaName,
    dedup_heart_rates: src.dedup_heart_rates ?? [],
    dedup_sleep_sessions: src.dedup_sleep_sessions ?? [],
    dedup_daily_steps: src.dedup_daily_steps ?? [],
  };
}

function logBundle(out, mode) {
  console.log(`Wrote ${OUT_PATH}  (mode: ${mode})`);
  const users = out.users ?? [{ user_id: out.user_id, ...out }];
  let totalRecords = 0;
  let totalLinked = 0;
  for (const u of users) {
    const hr = u.dedup_heart_rates ?? [];
    const sl = u.dedup_sleep_sessions ?? [];
    const st = u.dedup_daily_steps ?? [];
    const linked = [...hr, ...sl, ...st].filter(r => r.atlas_point_id).length;
    const total = hr.length + sl.length + st.length;
    totalRecords += total;
    totalLinked += linked;
    console.log(`  ${String(u.user_id).padEnd(14)}  HR ${String(hr.length).padStart(3)}  Sleep ${String(sl.length).padStart(3)}  Steps ${String(st.length).padStart(3)}  total ${String(total).padStart(4)}  ${linked ? `(${linked} linked to user-* atlas points)` : '(no atlas links — cohort exemplar)'}`);
  }
  console.log(`  TOTAL: ${totalRecords} records  /  ${totalLinked} linked to atlas points`);
}

const args = parseArgs(process.argv.slice(2));

if (args.personas) {
  if (!PERSONA_NAMES.includes(args.active)) {
    console.error(`--active must be one of: ${PERSONA_NAMES.join(', ')} (got "${args.active}")`);
    process.exit(2);
  }
  const users = [];
  for (const name of PERSONA_NAMES) {
    const path = resolve(HERE, `persona-${name}.json`);
    if (!existsSync(path)) {
      console.error(`Missing ${path}. Run \`task persona:generate-all\` first.`);
      process.exit(2);
    }
    const src = JSON.parse(readFileSync(path, 'utf8'));
    users.push(name === args.active ? tagAsUser(src) : tagAsCohort(src, name));
  }
  const out = { users };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  logBundle(out, `personas, active=${args.active}`);
} else {
  const path = args.input ? resolve(args.input) : resolve(HERE, 'generated_input.json');
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run \`task synth:generate\` or pass --input <path>.`);
    process.exit(2);
  }
  const src = JSON.parse(readFileSync(path, 'utf8'));
  const out = tagAsUser(src);
  out.user_id = src.user_id ?? 'user';
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  logBundle(out, 'single');
}
