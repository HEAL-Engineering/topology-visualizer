import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useAtlasStore } from '../store';
import { flattenUser, type RawRow } from '../schema/raw';
import type { AtlasPoint } from '../schema/types';
import { darken } from './ClusterLabels';

/**
 * EventCard — per-point detail card.
 *
 * Two trigger modes, both sharing the same render:
 *   - selected (click): pinned until the user closes it or selects another
 *     point. Shows the × close button.
 *   - hovered (cursor over a visible point): transient preview, dismissed
 *     the moment the cursor leaves the point. No close affordance — leaving
 *     the point is the dismissal.
 *
 * `selectedPoint` wins when both are set: click pins the card, hovering
 * elsewhere doesn't steal it away. The pinned card stays until the user
 * explicitly closes it.
 *
 * Raw provenance: when the loaded `rawBundle` contains records tagged with
 * this point's id via `atlas_point_id`, they're shown beneath the point
 * detail. Only user-* atlas points are linkable in the persona path
 * (cohort points are sampled independently in Python); cohort points
 * surface a brief "no raw provenance" note instead.
 *
 * Position is `top-56 left-8` so the card sits clear of the DataLoader's
 * Load / Template buttons (top-32, ~72px stack).
 */

const KIND_LABELS: Record<RawRow['kind'], string> = {
  heart_rate: 'HR',
  sleep: 'Sleep',
  steps: 'Steps',
};

const KIND_COLORS: Record<RawRow['kind'], string> = {
  heart_rate: '#ff6b6b',
  sleep: '#7c3aed',
  steps: '#34d399',
};

/** How many raw rows to render before collapsing to "+ N more". */
const RAW_PREVIEW_LIMIT = 8;

/**
 * Format sleep-stage minutes as `Xh Ym` (or `Ym` if under an hour, or
 * `Xh` on a clean hour boundary). Sleep durations of 90–500 min are
 * unreadable as raw minutes — "292" doesn't immediately register as
 * "almost five hours of light sleep" the way "4h 52m" does.
 */
function formatSleepDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Synthesize raw-style rows from a cohort point's `meta` biomarkers.
 *
 * Cohort atlas points are sampled independently by the Python pipeline
 * (np.random.normal from priors) and don't carry an atlas_point_id
 * back-link to specific dedup records — there are no dedup records to
 * link to. But each cohort point's meta already holds the 9 wearable
 * features that *would* be the daily aggregates if those records did
 * exist. This helper renders those features in the same row format as
 * the user-point flow so the EventCard reads consistently across
 * categories.
 *
 * The `source` is tagged "prototype" (not "synthetic") to make it
 * obvious in the UI that these rows aren't real device records —
 * they're the cohort's biomarker centroid for a prototypical day.
 */
function pointMetaToRawRows(point: AtlasPoint): RawRow[] {
  const meta = point.meta as Record<string, unknown> | undefined;
  if (!meta) return [];
  const num = (k: string): number | null => {
    const v = meta[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const rows: RawRow[] = [];
  const userId = String(point.category);
  const when = point.label ?? String(point.id);
  const source = 'prototype';

  const resting = num('resting_hr');
  const avg = num('avg_hr');
  const peak = num('peak_hr');
  if (resting !== null || avg !== null || peak !== null) {
    rows.push({
      userId,
      kind: 'heart_rate',
      source,
      when,
      value: Math.round(avg ?? resting ?? peak ?? 0),
      unit: 'bpm',
      details: `${resting != null ? Math.round(resting) : '?'}–${peak != null ? Math.round(peak) : '?'} bpm`,
      atlas_point_id: String(point.id),
    });
  }

  const sleepStages: { key: string; label: string }[] = [
    { key: 'sleep_deep_min',  label: 'Deep' },
    { key: 'sleep_rem_min',   label: 'REM' },
    { key: 'sleep_light_min', label: 'Light' },
    { key: 'sleep_awake_min', label: 'Awake' },
  ];
  for (const stage of sleepStages) {
    const v = num(stage.key);
    if (v === null) continue;
    rows.push({
      userId,
      kind: 'sleep',
      source,
      when,
      value: Math.round(v),
      unit: 'min',
      details: stage.label,
      atlas_point_id: String(point.id),
    });
  }

  const steps = num('steps');
  if (steps !== null) {
    rows.push({
      userId,
      kind: 'steps',
      source,
      when,
      value: Math.round(steps),
      unit: 'steps',
      details: '',
      atlas_point_id: String(point.id),
    });
  }

  return rows;
}

export default function EventCard() {
  const dataset = useAtlasStore(s => s.dataset);
  const rawBundle = useAtlasStore(s => s.rawBundle);
  const selectedPoint = useAtlasStore(s => s.selectedPoint);
  const hoveredPoint = useAtlasStore(s => s.hoveredPoint);
  const showTable = useAtlasStore(s => s.showTable);
  const theme = useAtlasStore(s => s.theme);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);
  const isLight = theme === 'light';

  // Selected pins the card; hover is the transient fallback. Selected
  // takes precedence so a click survives subsequent cursor motion.
  const activePoint = selectedPoint ?? hoveredPoint;
  const isPinned = selectedPoint !== null;

  const category = useMemo(() => {
    if (!dataset || !activePoint) return null;
    return dataset.categories.find(c => c.id === activePoint.category) ?? null;
  }, [dataset, activePoint]);

  // Category palette is tuned for additive blending on the dark scene
  // (sky #60a5fa, amber #fbbf24, emerald #34d399, etc.) — on the cream
  // paper bg those hues land near-white and the category chip becomes
  // unreadable. Darken toward black in light mode; pass-through in dark.
  const categoryTextColor = category
    ? (isLight ? darken(category.color, 0.55) : category.color)
    : undefined;

  // Pre-flatten the entire bundle once per bundle change. Lookup cost per
  // hover is then linear in the active point's record count, not the full
  // bundle. For the persona-mode bundle (~1.9k records) this is trivial.
  const rawRowsAll = useMemo<RawRow[]>(() => {
    if (!rawBundle) return [];
    const rows: RawRow[] = [];
    for (const u of Object.values(rawBundle.users)) rows.push(...flattenUser(u));
    return rows;
  }, [rawBundle]);

  // Two paths feed the raw section:
  //   1. atlas_point_id link → actual dedup records from the rawBundle
  //      (only present for user-* atlas points in the persona flow)
  //   2. fallback → synthesize rows from the point's meta biomarkers
  //      (used for cohort points; the meta IS the prototypical day's
  //      aggregate data — same 9 features the user records would have
  //      featurized into)
  const rawForPoint = useMemo<{ rows: RawRow[]; source: 'records' | 'prototype' | 'none' }>(() => {
    if (!activePoint) return { rows: [], source: 'none' };
    const targetId = String(activePoint.id);
    const linked = rawRowsAll.filter(r => r.atlas_point_id === targetId);
    if (linked.length > 0) return { rows: linked, source: 'records' };
    const synthesized = pointMetaToRawRows(activePoint);
    if (synthesized.length > 0) return { rows: synthesized, source: 'prototype' };
    return { rows: [], source: 'none' };
  }, [rawRowsAll, activePoint]);

  if (!activePoint || showTable || !category) return null;

  const isUserPoint = activePoint.category === 'user';
  const rawAvailable = rawBundle !== null;

  return (
    <div
      className="absolute top-56 left-8 z-20 w-[340px] border pointer-events-auto atlas-scroll"
      style={{
        background: 'var(--panel-bg-soft)',
        borderColor: `${category.color}${isPinned ? '30' : '22'}`,
        boxShadow: isPinned
          ? `0 0 60px ${category.color}20, inset 0 0 0 1px rgba(255,255,255,0.03)`
          : `0 0 30px ${category.color}12, inset 0 0 0 1px rgba(255,255,255,0.02)`,
        transition: 'border-color 120ms, box-shadow 120ms',
        maxHeight: 'calc(100vh - 16rem)',
        overflowY: 'auto',
      }}
    >
      <div className="px-5 pt-5 pb-3 border-b border-slate-700/30">
        <div className="flex items-start justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: category.color, boxShadow: `0 0 12px ${category.color}` }} />
            <span className="text-[10px] uppercase tracking-[0.28em] font-mono" style={{ color: categoryTextColor }}>
              {category.label}
            </span>
            {!isPinned && (
              <span className="text-[9px] tracking-[0.22em] uppercase text-slate-600 font-mono ml-1">
                · preview
              </span>
            )}
          </div>
          {isPinned && (
            <button onClick={() => setSelectedPoint(null)} className="text-slate-500 hover:text-slate-200 text-sm leading-none">×</button>
          )}
        </div>
        <div className="text-2xl font-light leading-tight font-serif">{activePoint.label ?? `Point #${activePoint.id}`}</div>
      </div>

      <div className="px-5 py-4 space-y-2.5 text-[11px] font-mono">
        {activePoint.value != null && (
          <div className="flex justify-between">
            <span className="text-slate-500 uppercase tracking-wider">Value</span>
            <span className="text-slate-200 tabular-nums">{activePoint.value}</span>
          </div>
        )}
        {activePoint.timestamp != null && (
          <div className="flex justify-between">
            <span className="text-slate-500 uppercase tracking-wider">Timestamp</span>
            <span className="text-slate-200 tabular-nums">
              {new Date(activePoint.timestamp).toLocaleString()}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500 uppercase tracking-wider">Coords</span>
          <span className="text-slate-200 tabular-nums">
            {activePoint.x.toFixed(2)}, {activePoint.y.toFixed(2)}, {activePoint.z.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 uppercase tracking-wider">ID</span>
          <span className="text-slate-200 tabular-nums">#{String(activePoint.id).padStart(4, '0')}</span>
        </div>
      </div>

      {/* Raw provenance.
          • user-* points: actual dedup records linked via atlas_point_id
          • cohort points: synthesized from `meta` biomarkers (the cohort's
            prototypical-day aggregate values).
          The header tag tells the user which one they're looking at. */}
      <div className="px-5 py-4 border-t border-slate-700/30">
        <div className="text-[10px] uppercase tracking-[0.28em] text-slate-500 font-mono mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Raw records</span>
            {rawForPoint.source === 'prototype' && (
              <span className="text-amber-400/70 tracking-[0.22em] text-[9px]">· prototype</span>
            )}
          </div>
          {rawForPoint.rows.length > 0 && (
            <span className="text-slate-400 tabular-nums">{rawForPoint.rows.length}</span>
          )}
        </div>
        {!rawAvailable && rawForPoint.source === 'none' && (
          <div className="text-[11px] text-slate-500 italic">
            No raw bundle loaded.
          </div>
        )}
        {rawAvailable && rawForPoint.source === 'none' && (
          <div className="text-[11px] text-slate-500 italic leading-relaxed">
            {isUserPoint
              ? 'No raw records reference this point.'
              : 'No biomarker meta on this point.'}
          </div>
        )}
        {rawForPoint.source === 'prototype' && (
          <div className="text-[10px] text-slate-500 italic leading-relaxed mb-2">
            Cohort exemplar — biomarker centroid for a prototypical {activePoint.category.replace('_', ' ')} day, not a real device record.
          </div>
        )}
        {rawForPoint.rows.length > 0 && (
          <div className="space-y-1.5 text-[10px] font-mono">
            {rawForPoint.rows.slice(0, RAW_PREVIEW_LIMIT).map((r, i) => {
              // Sleep durations are easier to scan as `Xh Ym` than raw
              // minutes — 292 minutes vs "4h 52m". Other kinds keep their
              // numeric value + unit (bpm, steps) since those are already
              // readable at a glance.
              const isSleep = r.kind === 'sleep';
              return (
                <div key={`${r.kind}-${i}`} className="flex items-center gap-2">
                  <span
                    className="w-1 h-1 rounded-full shrink-0"
                    style={{ background: KIND_COLORS[r.kind], boxShadow: `0 0 6px ${KIND_COLORS[r.kind]}` }}
                  />
                  <span className="text-slate-500 w-12 shrink-0">{KIND_LABELS[r.kind]}</span>
                  <span className="text-slate-300 tabular-nums shrink-0">
                    {isSleep ? (
                      formatSleepDuration(r.value)
                    ) : (
                      <>
                        {r.value}<span className="text-slate-600 ml-0.5 text-[9px]">{r.unit}</span>
                      </>
                    )}
                  </span>
                  <span className="text-slate-600 truncate">{r.details || formatWhenShort(r.when)}</span>
                </div>
              );
            })}
            {rawForPoint.rows.length > RAW_PREVIEW_LIMIT && (
              <div className="text-[10px] text-slate-600 italic pt-1">
                + {rawForPoint.rows.length - RAW_PREVIEW_LIMIT} more — open Table → Raw
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-slate-700/30 flex items-center gap-2 text-[10px] text-slate-500 font-mono">
        <Sparkles size={10} />
        <span>{isPinned ? "Click 'Table' for sortable view" : 'Click to pin'}</span>
      </div>
    </div>
  );
}

function formatWhenShort(when: string): string {
  if (when.length >= 16 && when.includes('T')) return `${when.slice(5, 10)} ${when.slice(11, 16)}`;
  return when.length >= 10 ? when.slice(5, 10) : when;
}
