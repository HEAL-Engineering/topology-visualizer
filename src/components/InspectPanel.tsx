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
 */
import { X, TrendingUp, Target } from 'lucide-react';
import { useAtlasStore } from '../store';
import { ARCHETYPE_READINGS } from '../data/archetype-readings';
import MorphTarget from './MorphTarget';

export default function InspectPanel() {
  const inspectedCategory = useAtlasStore(s => s.inspectedCategory);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);
  const dataset = useAtlasStore(s => s.dataset);
  const showTable = useAtlasStore(s => s.showTable);

  if (!inspectedCategory) return null;
  // Hide while the table drawer is open — drawer takes the same screen
  // real estate; the panel would otherwise stack awkwardly behind it.
  if (showTable) return null;

  const cat = dataset?.categories.find(c => c.id === inspectedCategory);
  const reading = ARCHETYPE_READINGS[inspectedCategory];
  if (!cat || !reading) return null;

  const accent = cat.color;
  const close = () => setInspectedCategory(null);
  const isUser = inspectedCategory === 'user';

  return (
    <div
      // Side panel, not full-screen modal — leaves the 3D scene visible so
      // the user can rotate / compare while reading.
      className="absolute top-24 right-8 bottom-16 z-20 w-[420px] flex flex-col border backdrop-blur-xl pointer-events-auto"
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
            style={{ color: accent }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
            />
            {cat.label}
          </div>
          <h2 className="text-xl font-light font-serif leading-tight">
            {reading.geometryLabel.split(' (')[0]}
          </h2>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            {reading.geometryLabel.includes('(') ? (reading.geometryLabel.split('(')[1] ?? '').replace(')', '') : ''}
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
            {reading.actions.map((a, i) => (
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
