import { useState } from 'react';
import { X, ChevronDown, TrendingUp, Target } from 'lucide-react';
import { useAtlasStore } from '../store';
import { ARCHETYPE_READINGS } from '../data/archetype-readings';

type Props = { open: boolean; onClose: () => void };


export default function TopologyInfo({ open, onClose }: Props) {
  const dataset = useAtlasStore(s => s.dataset);
  const [showDeep, setShowDeep] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!open) return null;

  const categories = dataset?.categories ?? [];

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-6 pointer-events-auto"
      style={{ background: 'var(--scrim-bg)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[720px] max-h-[88vh] overflow-y-auto border"
        style={{
          background: 'var(--panel-bg-strong)',
          borderColor: 'rgba(52, 211, 153, 0.25)',
          boxShadow: '0 0 80px rgba(52, 211, 153, 0.08), inset 0 0 0 1px rgba(255,255,255,0.03)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between px-7 pt-6 pb-4 border-b border-slate-700/40"
          style={{ background: 'rgba(10, 14, 26, 0.92)' }}>
          <div>
            <div className="text-[10px] tracking-[0.32em] text-emerald-400/80 uppercase font-mono mb-2">
              Reading the Atlas
            </div>
            <h2 className="text-2xl font-light font-serif">
              What the <span className="italic text-slate-300">shape</span> of your data means
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-7 py-6 space-y-6 text-[13px] leading-relaxed text-slate-300 font-light">
          <p>
            Each archetype in the atlas is rendered as a different polyhedron because its
            8-dimensional Wheel-of-Wellness signature has a different
            <span className="text-slate-100"> topological fingerprint</span>.
            The shape is not decoration — it is the literal geometry of that cohort's
            wellness profile after projection. Read the shape, and you read the user.
          </p>

          <div className="space-y-2">
            <div className="text-[10px] tracking-[0.32em] text-slate-500 uppercase font-mono pb-1">
              Reading rules
            </div>
            <Row dot="bg-emerald-400" term="Vertices" body="Sharp peaks = dimensions where this cohort excels above baseline." />
            <Row dot="bg-amber-300" term="Faces" body="Flat regions = dimensions that are present but undifferentiated — no growth, no deficit." />
            <Row dot="bg-rose-400" term="Holes" body="Genus &gt; 0 (torus) = a dimension perpetually orbited but never entered." />
            <Row dot="bg-sky-400" term="Symmetry" body="Higher symmetry = more even distribution across dimensions; lower headroom for breakthrough." />
            <Row dot="bg-violet-400" term="Position" body="Where the shape sits in the atlas tells you which cohort this user is drifting toward." />
          </div>

          <div className="pt-2 border-t border-slate-700/40 space-y-3">
            <div className="text-[10px] tracking-[0.32em] text-slate-500 uppercase font-mono pb-1">
              Archetype breakdowns
            </div>
            {categories.map(cat => {
              const reading = ARCHETYPE_READINGS[cat.id];
              if (!reading) return null;
              const isOpen = expanded === cat.id;
              return (
                <div
                  key={cat.id}
                  className="border"
                  style={{
                    borderColor: isOpen ? `${cat.color}55` : 'rgba(71, 85, 105, 0.35)',
                    background: isOpen ? `${cat.color}08` : 'var(--inset-bg)',
                    boxShadow: isOpen ? `0 0 40px ${cat.color}15, inset 0 0 0 1px ${cat.color}10` : undefined,
                    transition: 'all 200ms',
                  }}
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : cat.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: cat.color, boxShadow: `0 0 10px ${cat.color}` }}
                      />
                      <div>
                        <div className="text-slate-100 text-[13px] font-medium">
                          {cat.label}
                          <span className="ml-2 text-slate-500 font-mono text-[10px] tracking-[0.18em] uppercase">
                            {reading.geometryLabel}
                          </span>
                        </div>
                        <div className="text-slate-500 text-[11px] mt-0.5">
                          {reading.signature}
                        </div>
                      </div>
                    </div>
                    <ChevronDown
                      size={14}
                      className={`text-slate-500 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 space-y-4 border-t" style={{ borderColor: `${cat.color}20` }}>
                      <div>
                        <div className="text-[10px] tracking-[0.28em] uppercase font-mono mb-1.5"
                          style={{ color: cat.color }}>
                          Geometry
                        </div>
                        <p className="text-[12px] text-slate-400 leading-relaxed">
                          {reading.geometryNote}
                        </p>
                      </div>

                      <div>
                        <div className="text-[10px] tracking-[0.28em] uppercase font-mono mb-1.5 text-emerald-300 flex items-center gap-1.5">
                          <TrendingUp size={11} /> Strengths the shape encodes
                        </div>
                        <ul className="space-y-1.5 text-[12px] text-slate-300">
                          {reading.strengths.map((s, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-emerald-400/60 shrink-0">+</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="text-[10px] tracking-[0.28em] uppercase font-mono mb-1.5 text-amber-300 flex items-center gap-1.5">
                          <Target size={11} /> Action items — geometry → behavior
                        </div>
                        <ul className="space-y-2.5 text-[12px] text-slate-300">
                          {reading.actions.map((a, i) => (
                            <li key={i} className="flex gap-2.5">
                              <span className="text-amber-400/60 shrink-0 font-mono text-[10px] mt-0.5">{String(i + 1).padStart(2, '0')}</span>
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-700/40">
            <div className="text-[12px] text-slate-400 leading-relaxed">
              <span className="text-slate-200">Tip.</span> Click the
              <span className="text-rose-400"> User </span>
              cluster in the scene to open the morph panel — concrete metric gaps
              (calories, VO₂max, HRV, workout volume) and the training / diet steps
              to close them.
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/40">
            <button
              onClick={() => setShowDeep(v => !v)}
              className="flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-slate-400 hover:text-slate-200 font-mono transition-colors"
            >
              <ChevronDown
                size={12}
                className={`transition-transform ${showDeep ? 'rotate-180' : ''}`}
              />
              {showDeep ? 'Hide' : 'Show'} projection caveats
            </button>

            {showDeep && (
              <div className="mt-4 space-y-3 text-[12px] text-slate-400 leading-relaxed">
                <p>
                  Points are projected from the 8-dim Wheel-of-Wellness space to 3D via
                  UMAP fit on synthetic cohort prototypes (seed 42). Local distances are
                  reliable; global distances between far clusters are not.
                </p>
                <p>
                  <span className="text-slate-200">Why polyhedra and not blobs:</span>
                  {' '}each archetype's prototype yields a characteristic distribution of
                  daily-page points around its centroid. The convex hull of that
                  distribution is what we render. Sharp vertices appear where a single
                  dimension dominates the variance; smooth surfaces appear where variance
                  is spread evenly.
                </p>
                <p>
                  <span className="text-slate-200">What this can't tell you:</span>
                  {' '}causation, or whether two cohorts with the same shape mean the same
                  thing in the real world. The geometry surfaces hypotheses — always
                  validate by clicking individual points and reading the source entries.
                </p>
              </div>
            )}
          </div>

          <div className="pt-3 text-[10px] tracking-[0.24em] uppercase text-slate-600 font-mono">
            Click a point · drag to rotate · scroll to zoom
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ dot, term, body }: { dot: string; term: string; body: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <div>
        <span className="text-slate-100 font-medium">{term}.</span>{' '}
        <span className="text-slate-400">{body}</span>
      </div>
    </div>
  );
}
