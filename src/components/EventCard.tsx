import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useAtlasStore } from '../store';
import { flattenUser, type RawRow } from '../schema/raw';

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

export default function EventCard() {
  const dataset = useAtlasStore(s => s.dataset);
  const rawBundle = useAtlasStore(s => s.rawBundle);
  const selectedPoint = useAtlasStore(s => s.selectedPoint);
  const hoveredPoint = useAtlasStore(s => s.hoveredPoint);
  const showTable = useAtlasStore(s => s.showTable);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);

  // Selected pins the card; hover is the transient fallback. Selected
  // takes precedence so a click survives subsequent cursor motion.
  const activePoint = selectedPoint ?? hoveredPoint;
  const isPinned = selectedPoint !== null;

  const category = useMemo(() => {
    if (!dataset || !activePoint) return null;
    return dataset.categories.find(c => c.id === activePoint.category) ?? null;
  }, [dataset, activePoint]);

  // Pre-flatten the entire bundle once per bundle change. Lookup cost per
  // hover is then linear in the active point's record count, not the full
  // bundle. For the persona-mode bundle (~1.9k records) this is trivial.
  const rawRowsAll = useMemo<RawRow[]>(() => {
    if (!rawBundle) return [];
    const rows: RawRow[] = [];
    for (const u of Object.values(rawBundle.users)) rows.push(...flattenUser(u));
    return rows;
  }, [rawBundle]);

  const rawForPoint = useMemo<RawRow[]>(() => {
    if (!activePoint || rawRowsAll.length === 0) return [];
    const targetId = String(activePoint.id);
    return rawRowsAll.filter(r => r.atlas_point_id === targetId);
  }, [rawRowsAll, activePoint]);

  if (!activePoint || showTable || !category) return null;

  // Cohort points are sampled independently in Python and don't carry an
  // atlas_point_id back-link. Distinguish them from a genuinely empty
  // raw bundle so the message is honest about *why* there's nothing.
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
            <span className="text-[10px] uppercase tracking-[0.28em] font-mono" style={{ color: category.color }}>
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

      {/* Raw provenance — the dedup records that collapsed into this
          atlas point. Only meaningful for user-* points; cohort points
          surface a one-line note explaining the missing back-link. */}
      <div className="px-5 py-4 border-t border-slate-700/30">
        <div className="text-[10px] uppercase tracking-[0.28em] text-slate-500 font-mono mb-2.5 flex items-center justify-between">
          <span>Raw records</span>
          {rawForPoint.length > 0 && (
            <span className="text-slate-400 tabular-nums">{rawForPoint.length}</span>
          )}
        </div>
        {!rawAvailable && (
          <div className="text-[11px] text-slate-500 italic">
            No raw bundle loaded.
          </div>
        )}
        {rawAvailable && rawForPoint.length === 0 && (
          <div className="text-[11px] text-slate-500 italic leading-relaxed">
            {isUserPoint
              ? 'No raw records reference this point.'
              : 'Cohort exemplar — sampled independently; no raw provenance back-link.'}
          </div>
        )}
        {rawForPoint.length > 0 && (
          <div className="space-y-1.5 text-[10px] font-mono">
            {rawForPoint.slice(0, RAW_PREVIEW_LIMIT).map((r, i) => (
              <div key={`${r.kind}-${i}`} className="flex items-center gap-2">
                <span
                  className="w-1 h-1 rounded-full shrink-0"
                  style={{ background: KIND_COLORS[r.kind], boxShadow: `0 0 6px ${KIND_COLORS[r.kind]}` }}
                />
                <span className="text-slate-500 w-12 shrink-0">{KIND_LABELS[r.kind]}</span>
                <span className="text-slate-300 tabular-nums shrink-0">
                  {r.value}<span className="text-slate-600 ml-0.5 text-[9px]">{r.unit}</span>
                </span>
                <span className="text-slate-600 truncate">{r.details || formatWhenShort(r.when)}</span>
              </div>
            ))}
            {rawForPoint.length > RAW_PREVIEW_LIMIT && (
              <div className="text-[10px] text-slate-600 italic pt-1">
                + {rawForPoint.length - RAW_PREVIEW_LIMIT} more — open Table → Raw
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
