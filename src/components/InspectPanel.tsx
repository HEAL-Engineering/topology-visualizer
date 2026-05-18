/**
 * InspectPanel — surfaces archetype topology readings when the user clicks
 * any cluster (shape, label) or any point. The panel is opened by setting
 * `inspectedCategory` in the store; closing it clears the flag.
 *
 * Content shown:
 *   - Geometry note    (what the rendered polyhedron literally encodes)
 *   - Strengths        (what the shape gives positively)
 *   - Action items     (concrete behaviors, each anchored to a topological
 *                       feature so users see geometry → action causality)
 *   - Morph target     (user category only) — concrete metric gaps + diet /
 *                       training prescriptions to move toward an elite shape
 *
 * Sub-cluster pagination:
 *   When a category's points split into multiple spatial lobes, this panel
 *   renders a tab strip at the top — one tab per lobe — and surfaces the
 *   selected lobe's stats (point count, centroid) in the header. The
 *   archetype reading itself is category-wide (a torus is a torus regardless
 *   of which lobe), but each lobe gets its own header context.
 */
import { useMemo } from 'react';
import { X, TrendingUp, Target } from 'lucide-react';
import { useAtlasStore } from '../store';
import { useDerivedState, type CategoryShape } from '../lib/use-derived';
import { ARCHETYPE_READINGS } from '../data/archetype-readings';
import { generateLobeActions } from '../lib/lobe-actions';
import MorphTarget from './MorphTarget';
import { darken } from './ClusterLabels';

export default function InspectPanel() {
  // ── All hooks first (Rules of Hooks: same order every render) ─────────
  const inspectedCategory = useAtlasStore(s => s.inspectedCategory);
  const inspectedSubIndex = useAtlasStore(s => s.inspectedSubIndex);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);
  const setInspectedSubIndex = useAtlasStore(s => s.setInspectedSubIndex);
  const dataset = useAtlasStore(s => s.dataset);
  const showTable = useAtlasStore(s => s.showTable);
  const { clusterShapes, pointSubIndex } = useDerivedState();

  // Plain derived values (not hooks) — safe to compute even when the panel
  // ends up bailing out below, because the hooks that depend on them must
  // still run on every render.
  const cat = inspectedCategory
    ? dataset?.categories.find(c => c.id === inspectedCategory)
    : undefined;
  const reading = inspectedCategory ? ARCHETYPE_READINGS[inspectedCategory] : undefined;
  const subs: CategoryShape[] = inspectedCategory
    ? clusterShapes
        .filter(cs => cs.category.id === inspectedCategory)
        .sort((a, b) => a.subIndex - b.subIndex)
    : [];
  const subCount = subs.length;
  // Clamp the active tab to the valid range; sub-cluster count can drop
  // (e.g. after dataset reload) below the previously-selected index.
  const activeIdx = Math.min(Math.max(inspectedSubIndex, 0), Math.max(0, subCount - 1));
  const activeSub: CategoryShape | undefined = subs[activeIdx];
  const isUser = inspectedCategory === 'user';

  // Points belonging to *this specific lobe* (or the whole category when
  // subCount === 1). Drives the per-lobe action generator below. Must sit
  // before any early-return so the hook order stays stable across renders.
  const lobePoints = useMemo(() => {
    if (!dataset || !inspectedCategory) return [];
    return dataset.points.filter(p => {
      if (p.category !== inspectedCategory) return false;
      const sub = pointSubIndex.get(p.id) ?? 0;
      return sub === activeIdx;
    });
  }, [dataset, pointSubIndex, inspectedCategory, activeIdx]);

  // For the user category, action items are derived from THIS lobe's actual
  // pipeline-feature means (so two lobes with different averages surface
  // different advice). For cohort categories the static archetype reading
  // is fine — those are baseline references, not user-mutable.
  const actions = useMemo(() => {
    if (isUser) {
      const generated = generateLobeActions(lobePoints);
      if (generated.length > 0) return generated;
    }
    return reading?.actions ?? [];
  }, [isUser, lobePoints, reading]);

  const theme = useAtlasStore(s => s.theme);
  const isLight = theme === 'light';

  // ── Early returns AFTER all hooks ─────────────────────────────────────
  if (!inspectedCategory) return null;
  // Hide while the table drawer is open — drawer takes the same screen
  // real estate; the panel would otherwise stack awkwardly behind it.
  if (showTable) return null;
  if (!cat || !reading) return null;

  const accent = cat.color;
  // Text-only accent. Category palette is tuned for additive blending on
  // the dark scene (sky/amber/emerald land near-white on cream), so any
  // chip or heading rendered AS TEXT needs a darkened variant in light
  // mode. Borders / boxShadows still use the raw accent — they read fine.
  const accentText = isLight ? darken(accent, 0.55) : accent;
  const close = () => setInspectedCategory(null);

  return (
    <div
      // Side panel, not full-screen modal — leaves the 3D scene visible so
      // the user can rotate / compare while reading.
      className="absolute top-24 right-8 bottom-16 z-20 w-[420px] flex flex-col border pointer-events-auto"
      style={{
        background: 'var(--panel-bg-strong)',
        borderColor: `${accent}40`,
        boxShadow: `0 0 60px ${accent}18, inset 0 0 0 1px rgba(255,255,255,0.03)`,
      }}
    >
      <div
        className="shrink-0 flex items-start justify-between px-5 pt-5 pb-3 border-b"
        style={{ borderColor: `${accent}25` }}
      >
        <div className="min-w-0">
          <div
            className="text-[10px] tracking-[0.32em] uppercase font-mono mb-2 flex items-center gap-2"
            style={{ color: accentText }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
            />
            {cat.label}
          </div>
          <h2 className="text-xl font-light font-serif leading-tight">
            {reading.geometryLabel.split(' (')[0]}
            {subCount > 1 && (
              <span className="text-slate-500 text-base"> · Lobe {activeIdx + 1}</span>
            )}
          </h2>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            {reading.geometryLabel.includes('(') ? (reading.geometryLabel.split('(')[1] ?? '').replace(')', '') : ''}
            {activeSub && (
              <span className="ml-2 text-slate-600">
                · {activeSub.pointCount} pt{activeSub.pointCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={close}
          className="text-slate-500 hover:text-slate-200 transition-colors shrink-0 ml-2"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {subCount > 1 && (
        <div
          className="shrink-0 flex border-b"
          style={{ borderColor: `${accent}25` }}
        >
          {subs.map((s, i) => {
            const on = i === activeIdx;
            return (
              <button
                key={s.subIndex}
                onClick={() => setInspectedSubIndex(s.subIndex)}
                className="flex-1 px-3 py-2.5 text-[10px] tracking-[0.22em] uppercase font-mono transition-all"
                style={{
                  color: on ? accentText : (isLight ? '#475569' : '#94a3b8'),
                  background: on ? `${accent}10` : 'transparent',
                  borderBottom: `2px solid ${on ? accent : 'transparent'}`,
                }}
                title={`Switch to lobe ${i + 1} (${s.pointCount} pts)`}
              >
                Lobe {i + 1}
                <span className="ml-2 opacity-60 normal-case tracking-normal">
                  {s.pointCount} pt{s.pointCount === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 text-[12px] text-slate-300 leading-relaxed">
        <p className="text-slate-400 italic">{reading.signature}</p>

        <div>
          <div className="text-[10px] tracking-[0.28em] uppercase font-mono mb-1.5 text-slate-400">
            Geometry
          </div>
          <p className="text-slate-400">{reading.geometryNote}</p>
        </div>

        <div>
          <div className="text-[10px] tracking-[0.28em] uppercase font-mono mb-2 text-emerald-300 flex items-center gap-1.5">
            <TrendingUp size={11} /> Strengths the shape encodes
          </div>
          <ul className="space-y-1.5">
            {reading.strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-emerald-400/60 shrink-0">+</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-[10px] tracking-[0.28em] uppercase font-mono mb-2 text-amber-300 flex items-center gap-1.5">
            <Target size={11} /> Action items — geometry → behavior
          </div>
          <ul className="space-y-2.5">
            {actions.map((a, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-amber-400/60 shrink-0 font-mono text-[10px] mt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="text-[10px] tracking-[0.18em] uppercase font-mono text-slate-500 mb-0.5">
                    {a.from}
                  </div>
                  <div className="text-slate-200">{a.do}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {isUser && (
          <div className="pt-4 border-t border-slate-700/40">
            <MorphTarget />
          </div>
        )}
      </div>
    </div>
  );
}
