/**
 * Generate a synthetic AtlasDataset for first-load demo.
 *
 * Uses the seeded PRNG so the same seed produces the same dataset across
 * reloads. Mirrors the eight-dimension wellness wheel that motivated this
 * project, but the shape (8 clusters, ~80 points each, manifold-like spread)
 * is generic enough for any domain.
 */
import type { AtlasDataset, AtlasPoint } from '../schema/types';
import { mulberry32 } from '../lib/prng';

const CATEGORIES = [
  { id: 'physical',      label: 'Physical',      color: '#ff6b6b', center: [ 3.2,  1.0, -2.2], events: ['Sleep recovery', 'HRV reading', 'Workout intensity', 'Step total', 'Resting HR'] },
  { id: 'emotional',     label: 'Emotional',     color: '#ff9ec4', center: [-3.0,  2.2,  1.1], events: ['Mood log', 'Stress signal', 'Gratitude entry', 'Journal note'] },
  { id: 'social',        label: 'Social',        color: '#ffc857', center: [ 1.0, -3.0,  2.4], events: ['Calendar event', 'Family call', 'Shared workout', 'Message thread'] },
  { id: 'intellectual',  label: 'Intellectual',  color: '#4ecdc4', center: [-2.4, -2.2, -2.0], events: ['Reading session', 'Course progress', 'Note captured', 'Skill practice'] },
  { id: 'spiritual',     label: 'Spiritual',     color: '#b794f4', center: [ 4.0, -1.2,  3.2], events: ['Meditation', 'Reflection', 'Walk in nature', 'Quiet hour'] },
  { id: 'occupational',  label: 'Occupational',  color: '#a3e635', center: [-4.2, -0.8, -1.4], events: ['Deep work block', 'Meeting', 'Project milestone', 'Email triaged'] },
  { id: 'environmental', label: 'Environmental', color: '#34d399', center: [ 2.4,  3.2, -3.0], events: ['Time outdoors', 'Air quality', 'Sunlight exposure', 'Travel'] },
  { id: 'financial',     label: 'Financial',     color: '#60a5fa', center: [-1.0,  1.4,  4.0], events: ['Transaction', 'Budget check', 'Savings progress', 'Investment'] },
];

const MAPPER_EDGES = [
  ['physical', 'emotional', 0.85], ['physical', 'environmental', 0.72], ['physical', 'spiritual', 0.55],
  ['emotional', 'social', 0.78], ['emotional', 'spiritual', 0.68],
  ['social', 'occupational', 0.74],
  ['intellectual', 'occupational', 0.88], ['intellectual', 'spiritual', 0.50],
  ['occupational', 'financial', 0.82], ['environmental', 'spiritual', 0.66],
] as const;

export function generateSyntheticDataset(count = 640, seed = 1729): AtlasDataset {
  const rand = mulberry32(seed);
  const points: AtlasPoint[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const dim = CATEGORIES[i % CATEGORIES.length]!;
    const t = rand() * Math.PI * 2;
    const arm = rand();
    const r = arm * 1.6 + 0.2;
    const offsetX = Math.cos(t) * r + (rand() - 0.5) * 0.6;
    const offsetY = Math.sin(t) * r * 0.65 + (rand() - 0.5) * 1.0;
    const offsetZ = (rand() - 0.5) * 1.2 + Math.sin(arm * Math.PI) * 0.5;
    const event = dim.events[Math.floor(rand() * dim.events.length)]!;
    const hoursAgo = Math.floor(rand() * 24 * 30);
    points.push({
      id: i,
      x: dim.center[0]! + offsetX,
      y: dim.center[1]! + offsetY,
      z: dim.center[2]! + offsetZ,
      category: dim.id,
      label: event,
      value: parseFloat((rand() * 100).toFixed(1)),
      timestamp: now - hoursAgo * 3600 * 1000,
    });
  }

  return {
    meta: { title: 'Wellness Atlas — Synthetic', projection: 'umap', seed, generatedAt: now },
    categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, color: c.color, position: c.center as [number, number, number] })),
    mapperEdges: MAPPER_EDGES.map(([from, to, weight]) => ({ from, to, weight })),
    points,
  };
}
