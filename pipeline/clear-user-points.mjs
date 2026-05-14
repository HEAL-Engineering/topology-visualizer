#!/usr/bin/env node
/**
 * clear-user-points.mjs
 *
 * Strip every point with `category: 'user'` from public/atlas.json. The
 * cohort points (avg_male, avg_female, elite_male, elite_female) and the
 * categories array are left intact, so the 3D scene still renders the
 * reference topology — only the user cluster vanishes.
 *
 * Purpose: produce a "before" state for the raw → atlas conversion demo.
 * After running this, hard-refresh the browser to see cohorts only. Then
 * run `task demo:hydrate-user` to feed public/raw.json through the Python
 * pipeline and watch the user cluster reappear, derived from the raw
 * records visible in the Table → Raw tab.
 *
 * Idempotent: rerunning has no further effect once user points are gone.
 *
 * Run with:
 *   node pipeline/clear-user-points.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ATLAS_PATH = resolve(HERE, '..', 'public', 'atlas.json');

const atlas = JSON.parse(readFileSync(ATLAS_PATH, 'utf8'));
const before = atlas.points.length;
atlas.points = atlas.points.filter(p => p.category !== 'user');
const after = atlas.points.length;
const removed = before - after;

writeFileSync(ATLAS_PATH, JSON.stringify(atlas, null, 2));

console.log(`Cleared user points from ${ATLAS_PATH}`);
console.log(`  removed: ${removed}`);
console.log(`  remaining: ${after} points across ${atlas.categories.length} categories`);
console.log('');
console.log('Hard-refresh the browser to see the empty user cluster, then run:');
console.log('  task demo:hydrate-user');
