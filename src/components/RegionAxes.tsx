/**
 * RegionAxes — trajectory-mode annotations that explain what each direction
 * in the atlas means.
 *
 * UMAP coordinates have no inherent meaning, but the cohort priors define
 * emergent directions: avg_male → elite_male collapses to "lower RHR,
 * more steps, deeper sleep" because that's the biomarker delta between
 * the two priors. When a phantom trajectory is projected, this component
 * surfaces the relevant directional semantics directly in the scene.
 *
 * Two layers, both gated on `phantomActive`:
 *
 *   1. Cohort caption — a one-line "what living here means" tag below
 *      each cohort centroid (e.g. "Sedentary baseline · RHR 66").
 *
 *   2. Pair arrows — thin lines between paired cohort centroids with a
 *      midpoint label describing the directional change ("Train harder
 *      → lower RHR, more steps, deeper sleep").
 *
 * Hidden entirely when no phantom trajectory is active or when a
 * metric lens is on (the lens replaces category coloring and these
 * annotations would compete with the heatmap).
 */
import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useAtlasStore } from '../store';

interface AxisDef {
  from: string;
  to: string;
  /** Caption rendered at the line midpoint. Use unicode arrows for direction. */
  meaning: string;
}

const COHORT_CAPTIONS: Record<string, string> = {
  avg_male:    'Sedentary baseline · RHR 66 · 5.3k steps',
  avg_female:  'Sedentary baseline · RHR 68 · 4.9k steps',
  elite_male:  'Endurance-trained · RHR 40 · 15k steps',
  elite_female:'Endurance-trained · RHR 44 · 14k steps',
  user:        'You — where your wearable data lives',
};

const COHORT_AXES: AxisDef[] = [
  { from: 'avg_male',   to: 'elite_male',   meaning: 'Train harder → lower RHR, more steps, deeper sleep' },
  { from: 'avg_female', to: 'elite_female', meaning: 'Train harder → lower RHR, more steps, deeper sleep' },
  { from: 'avg_male',   to: 'avg_female',   meaning: 'Female: ↑ RHR, ↑ sleep duration, ↓ steps' },
  { from: 'elite_male', to: 'elite_female', meaning: 'Female: slightly ↑ RHR, similar training volume' },
];

export default function RegionAxes() {
  const dataset = useAtlasStore(s => s.dataset);
  const showPhantom = useAtlasStore(s => s.showPhantom);
  const activePhantomKey = useAtlasStore(s => s.activePhantomKey);
  const phantomActive = showPhantom && activePhantomKey !== null;
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const theme = useAtlasStore(s => s.theme);
  const isLight = theme === 'light';

  // Per-cohort centroid from cluster points. Computed once per dataset.
  const centroids = useMemo(() => {
    const out = new Map<string, THREE.Vector3>();
    if (!dataset) return out;
    const buckets = new Map<string, { x: number; y: number; z: number; n: number }>();
    for (const p of dataset.points) {
      const b = buckets.get(p.category) ?? { x: 0, y: 0, z: 0, n: 0 };
      b.x += p.x; b.y += p.y; b.z += p.z; b.n += 1;
      buckets.set(p.category, b);
    }
    for (const [cat, b] of buckets) {
      if (b.n === 0) continue;
      out.set(cat, new THREE.Vector3(b.x / b.n, b.y / b.n, b.z / b.n));
    }
    return out;
  }, [dataset]);

  if (!phantomActive || !dataset || activeMetric) return null;

  const visibleCohorts = Array.from(centroids.entries()).filter(
    ([cat]) => enabledCategories.has(cat) && COHORT_CAPTIONS[cat] !== undefined
  );

  const visibleAxes = COHORT_AXES.filter(a =>
    centroids.has(a.from) && centroids.has(a.to)
    && enabledCategories.has(a.from) && enabledCategories.has(a.to)
  );

  const captionBg = isLight ? 'rgba(255, 252, 246, 0.85)' : 'rgba(4, 7, 17, 0.78)';
  const captionFg = isLight ? '#475569' : '#94a3b8';
  const captionBorder = isLight ? 'rgba(100, 116, 139, 0.25)' : 'rgba(148, 163, 184, 0.18)';
  const axisLineColor = isLight ? '#94a3b8' : '#64748b';
  const axisLabelBg = isLight ? 'rgba(255, 252, 246, 0.92)' : 'rgba(10, 14, 26, 0.88)';
  const axisLabelFg = isLight ? '#475569' : '#cbd5e1';

  return (
    <group>
      {/* Pair arrows — thin native lines between cohort centroids with a
          midpoint caption describing what the direction means. Caption
          is lifted above the line midpoint and staggered per-axis so
          adjacent arrows' captions don't stack into an unreadable pile. */}
      {visibleAxes.map((axis, i) => {
        const a = centroids.get(axis.from)!;
        const b = centroids.get(axis.to)!;
        const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
        // Base lift clears the line; per-axis stagger separates labels
        // whose midpoints land near each other in 3D space.
        const labelLift = 0.9 + i * 0.45;
        return (
          <group key={`${axis.from}->${axis.to}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={axisLineColor}
                opacity={0.55}
                transparent
              />
            </line>
            <Html
              position={[midpoint.x, midpoint.y + labelLift, midpoint.z]}
              center
              distanceFactor={14}
              occlude={false}
              style={{ pointerEvents: 'none' }}
              zIndexRange={[2, 0]}
            >
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  padding: '3px 7px',
                  background: axisLabelBg,
                  color: axisLabelFg,
                  border: `1px solid ${captionBorder}`,
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                  opacity: 0.92,
                  userSelect: 'none',
                }}
              >
                {axis.meaning}
              </div>
            </Html>
          </group>
        );
      })}

      {/* Per-cohort caption — sits just below the cluster centroid so it
          doesn't fight with ClusterLabels (which sit above). */}
      {visibleCohorts.map(([cat, centroid]) => {
        const caption = COHORT_CAPTIONS[cat]!;
        return (
          <Html
            key={`caption-${cat}`}
            position={[centroid.x, centroid.y - 0.9, centroid.z]}
            center
            distanceFactor={14}
            occlude={false}
            style={{ pointerEvents: 'none' }}
            zIndexRange={[3, 0]}
          >
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 9,
                letterSpacing: '0.16em',
                padding: '3px 8px',
                background: captionBg,
                color: captionFg,
                border: `1px solid ${captionBorder}`,
                borderRadius: 2,
                whiteSpace: 'nowrap',
                textTransform: 'uppercase',
                userSelect: 'none',
              }}
            >
              {caption}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
