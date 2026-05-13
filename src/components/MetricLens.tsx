/**
 * MetricLens — bottom-right toggle panel that projects a single biomarker
 * field onto the 3D point cloud as a viridis-style heatmap.
 *
 * Behavior:
 *   - One metric active at a time (radio). Click an active button to clear.
 *   - When active, PointCloud reads `activeMetric` from the store and
 *     recolors every point by `meta.biomarkers[key]` (see PointCloud).
 *   - Points missing the field fade to near-zero so the lens reads as a
 *     filter as well as a colormap.
 *   - Renders a small legend strip + endpoints when a lens is active.
 *
 * Direction handling lives in `data/metrics.ts` (`higherIsBetter`) so the
 * warm end of the ramp consistently means "good" regardless of whether the
 * underlying field is up- or down-oriented (e.g. VO₂max ↑ vs resting HR ↓).
 */
import { Eye, X } from 'lucide-react';
import { useAtlasStore } from '../store';
import { METRICS, type MetricDef } from '../data/metrics';

export default function MetricLens() {
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const setActiveMetric = useAtlasStore(s => s.setActiveMetric);
  const dataset = useAtlasStore(s => s.dataset);

  if (!dataset) return null;

  const active = METRICS.find(m => m.key === activeMetric) ?? null;

  return (
    <div
      // Anchored to the left side, just above the FilterPanel (which sits at
      // bottom-8 with maxHeight 50vh). This keeps the lens out of the
      // InspectPanel's right-side zone so per-point / per-cluster info
      // overlays no longer cover it.
      className="absolute left-8 z-20 pointer-events-auto"
      style={{ width: 340, bottom: 'calc(50vh + 24px)' }}
    >
      <div
        className="px-4 py-3 border"
        style={{
          background: 'var(--panel-bg)',
          borderColor: active ? 'rgba(251, 191, 36, 0.45)' : 'rgba(71, 85, 105, 0.4)',
          boxShadow: active
            ? '0 0 24px rgba(251, 191, 36, 0.15), inset 0 0 0 1px rgba(255,255,255,0.03)'
            : 'inset 0 0 0 1px rgba(255,255,255,0.02)',
          transition: 'border-color 200ms, box-shadow 200ms',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye size={11} className={active ? 'text-amber-300' : 'text-slate-500'} />
            <span className="text-[10px] tracking-[0.32em] text-slate-400 uppercase font-mono">
              Metric lens
            </span>
          </div>
          {active && (
            <button
              onClick={() => setActiveMetric(null)}
              className="text-slate-500 hover:text-slate-200 transition-colors text-[10px] tracking-[0.22em] uppercase font-mono flex items-center gap-1"
              title="Clear lens"
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {METRICS.map(m => {
            const on = activeMetric === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setActiveMetric(on ? null : m.key)}
                className="px-2.5 py-1.5 text-left border transition-all font-mono"
                style={{
                  borderColor: on ? 'rgba(251, 191, 36, 0.6)' : 'rgba(71, 85, 105, 0.5)',
                  background: on ? 'rgba(251, 191, 36, 0.08)' : 'transparent',
                  color: on ? '#fcd34d' : '#94a3b8',
                }}
              >
                <div className="text-[10px] tracking-[0.16em] uppercase leading-tight">
                  {m.label}
                </div>
                <div className="text-[9px] tracking-[0.1em] mt-0.5 opacity-60">
                  {m.unit}
                </div>
              </button>
            );
          })}
        </div>

        {active && <Legend metric={active} />}
      </div>
    </div>
  );
}

function Legend({ metric }: { metric: MetricDef }) {
  const [lo, hi] = metric.range;
  // The ramp itself reads left → right as "0 → 1" after normalization, so
  // for higher-is-better the left label is the low raw value, for lower-is-
  // better the left label is the high raw value (because we invert).
  const leftRaw = metric.higherIsBetter ? lo : hi;
  const rightRaw = metric.higherIsBetter ? hi : lo;
  return (
    <div className="mt-3 pt-3 border-t border-slate-700/40">
      <div
        className="h-2 w-full"
        style={{
          background: 'linear-gradient(to right, #1e3a8a, #06b6d4, #84cc16, #facc15, #f97316, #dc2626)',
          boxShadow: '0 0 10px rgba(251, 191, 36, 0.25)',
        }}
      />
      <div className="flex justify-between text-[9px] tracking-[0.16em] uppercase font-mono text-slate-500 mt-1.5">
        <span>{leftRaw} {metric.unit}</span>
        <span className="text-amber-300/80">{metric.label}</span>
        <span>{rightRaw} {metric.unit}</span>
      </div>
    </div>
  );
}
