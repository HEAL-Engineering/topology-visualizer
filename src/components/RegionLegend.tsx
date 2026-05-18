/**
 * RegionLegend — floating 2D card that explains what each region of the
 * atlas means in plain text.
 *
 * The 3D in-scene captions and arrows (RegionAxes) anchor the meaning
 * spatially, but they're brief and depend on camera angle. This legend
 * is the textual companion: a flat, readable summary the user can scan
 * without rotating the scene. Shown when the Axes toggle is on, OR
 * when a phantom trajectory is active (the trajectory raises the
 * "where would I land?" question and the legend names the answer).
 *
 * Hidden when:
 *   - both showRegionAxes and the phantom trajectory are off
 *   - a MetricLens is active (the lens replaces category semantics; the
 *     legend would describe the wrong frame)
 */
import { useMemo } from 'react';
import { useAtlasStore } from '../store';

interface RegionEntry {
  categoryId: string;
  /** Short headline — what kind of region this is */
  headline: string;
  /** One-line description of the biomarker signature */
  signature: string;
  /** What being near this region means for the user */
  meaning: string;
}

const REGIONS: RegionEntry[] = [
  {
    categoryId: 'avg_male',
    headline: 'Sedentary baseline (M)',
    signature: 'RHR 66 · 5.3k steps · 7h29m sleep',
    meaning: 'Typical US adult male wearable profile. Limited cardio adaptation.',
  },
  {
    categoryId: 'avg_female',
    headline: 'Sedentary baseline (F)',
    signature: 'RHR 68 · 4.9k steps · 7h50m sleep',
    meaning: 'Typical US adult female. Slightly more sleep, fewer steps than M peers.',
  },
  {
    categoryId: 'elite_male',
    headline: 'Endurance-trained (M)',
    signature: 'RHR 40 · 15k steps · 8h40m sleep',
    meaning: 'Marathon/cyclist-tier conditioning. Deep + REM sleep elevated for recovery.',
  },
  {
    categoryId: 'elite_female',
    headline: 'Endurance-trained (F)',
    signature: 'RHR 44 · 14k steps · 8h45m sleep',
    meaning: 'Elite female endurance profile. ~5 bpm above male elite peers.',
  },
  {
    categoryId: 'user',
    headline: 'You',
    signature: 'Your wearable days projected into the cohort space',
    meaning: 'Closer to a cohort centroid → biomarker profile closer to that cohort.',
  },
];

/**
 * Axis interpretations — what it means to move between cohorts. Listed
 * always; in-scene arrows for these directions only appear while a
 * phantom trajectory is active, so the legend is the always-available
 * textual reference.
 */
const AXES_LEGEND: { label: string; meaning: string }[] = [
  { label: 'Avg → Elite',   meaning: 'Lower RHR, more daily steps, longer deep + REM sleep.' },
  { label: 'Male → Female', meaning: 'Higher RHR, longer total sleep, slightly fewer steps.' },
];

export default function RegionLegend() {
  const dataset = useAtlasStore(s => s.dataset);
  const showRegionAxes = useAtlasStore(s => s.showRegionAxes);
  const showPhantom = useAtlasStore(s => s.showPhantom);
  const activePhantomKey = useAtlasStore(s => s.activePhantomKey);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const setHoveredCategory = useAtlasStore(s => s.setHoveredCategory);
  const theme = useAtlasStore(s => s.theme);
  const isLight = theme === 'light';

  const phantomActive = showPhantom && activePhantomKey !== null;

  // Look up the live category color so dots match the rendered cohort.
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    dataset?.categories.forEach(c => m.set(c.id, c.color));
    return m;
  }, [dataset]);

  const visibleRegions = useMemo(
    () => REGIONS.filter(r => colorById.has(r.categoryId)),
    [colorById]
  );

  if ((!showRegionAxes && !phantomActive) || !dataset || activeMetric) return null;
  if (visibleRegions.length === 0) return null;

  const bg = isLight ? 'rgba(255, 252, 246, 0.92)' : 'rgba(10, 14, 26, 0.88)';
  const border = isLight ? 'rgba(100, 116, 139, 0.25)' : 'rgba(148, 163, 184, 0.18)';
  const headlineFg = isLight ? '#1e293b' : '#e2e8f0';
  const bodyFg = isLight ? '#475569' : '#94a3b8';
  const subFg = isLight ? '#64748b' : '#64748b';

  return (
    <div
      className="absolute top-32 right-8 z-20 pointer-events-auto atlas-scroll"
      style={{
        width: 320,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 2,
        padding: '14px 16px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: subFg,
          marginBottom: 10,
        }}
      >
        Region guide
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {visibleRegions.map(r => {
          const color = colorById.get(r.categoryId) ?? '#64748b';
          const enabled = enabledCategories.has(r.categoryId);
          const dimmed = hoveredCategory != null && hoveredCategory !== r.categoryId;
          return (
            <div
              key={r.categoryId}
              onMouseEnter={() => setHoveredCategory(r.categoryId)}
              onMouseLeave={() => setHoveredCategory(null)}
              style={{
                opacity: !enabled ? 0.35 : (dimmed ? 0.45 : 1),
                transition: 'opacity 120ms',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 10px ${color}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11, color: headlineFg, letterSpacing: '0.05em' }}>
                  {r.headline}
                </span>
              </div>
              <div style={{ fontSize: 9, color: subFg, marginLeft: 16, letterSpacing: '0.06em' }}>
                {r.signature}
              </div>
              <div style={{ fontSize: 10, color: bodyFg, marginLeft: 16, marginTop: 3, fontFamily: 'ui-serif, Georgia, serif', lineHeight: 1.4 }}>
                {r.meaning}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          borderTop: `1px solid ${border}`,
          paddingTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: subFg,
            marginBottom: 2,
          }}
        >
          Axis meanings
        </div>
        {AXES_LEGEND.map(a => (
          <div key={a.label}>
            <div style={{ fontSize: 10, color: headlineFg, letterSpacing: '0.06em' }}>
              {a.label}
            </div>
            <div style={{ fontSize: 10, color: bodyFg, fontFamily: 'ui-serif, Georgia, serif', lineHeight: 1.4 }}>
              {a.meaning}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
