/**
 * RegionAxes — in-scene "quadrant" highlights, captions, and (optional)
 * pair-arrows that explain what each region of the atlas means.
 *
 * UMAP coordinates have no inherent meaning, but the cohort priors define
 * emergent directions: avg_male → elite_male collapses to "lower RHR,
 * more steps, deeper sleep" because that's the biomarker delta between
 * the two priors. This component surfaces those interpretations directly
 * in the 3D scene so the user can read the topology without leaving the
 * canvas.
 *
 * Three layers, each gated independently:
 *
 *   1. Quadrant highlight (showRegionAxes)
 *      A translucent color-matched sphere around each cohort centroid,
 *      sized to encompass that cohort's points — the visual "this is
 *      avg_male territory" marker. Larger than ClusterShapes' fitted
 *      hull so it reads as a region, not a cluster surface.
 *
 *   2. Cohort caption (showRegionAxes OR phantomActive)
 *      A one-line "what living here means" tag below each centroid
 *      (e.g. "Sedentary baseline · RHR 66 · 5.3k steps"). Always
 *      paired with whichever layer is on.
 *
 *   3. Pair arrows (phantomActive ONLY)
 *      Thin lines between paired cohorts with a midpoint label
 *      describing the directional change ("Train harder → lower RHR,
 *      more steps, deeper sleep"). Only shown while a phantom
 *      trajectory is being projected, since arrows make the most
 *      sense when answering "if I trained, which direction would I
 *      move?".
 *
 * Hidden entirely when an activeMetric (lens) is on — the lens already
 * replaces category coloring, and these annotations would compete with
 * the heatmap.
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

/**
 * Multiplier on the cluster's bounding radius for the quadrant highlight
 * sphere. > 1.0 so the highlight clearly envelops the cluster shape and
 * reads as "the surrounding region", not "the cluster surface". 1.6 was
 * picked by eye — smaller looked like a duplicate hull, larger overlapped
 * neighboring cohorts.
 */
const QUADRANT_SCALE = 1.6;

/** Floor on the highlight radius so a tightly-clumped cohort still reads as a region. */
const MIN_QUADRANT_RADIUS = 1.2;

export default function RegionAxes() {
  const dataset = useAtlasStore(s => s.dataset);
  const showRegionAxes = useAtlasStore(s => s.showRegionAxes);
  const showPhantom = useAtlasStore(s => s.showPhantom);
  const activePhantomKey = useAtlasStore(s => s.activePhantomKey);
  const phantomActive = showPhantom && activePhantomKey !== null;
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const theme = useAtlasStore(s => s.theme);
  const isLight = theme === 'light';

  // Per-cohort centroid + max-radius from cluster points. Radius is the
  // distance from centroid to the farthest point; we scale that for the
  // quadrant highlight sphere. Computed once per dataset.
  const regions = useMemo(() => {
    const out = new Map<string, { centroid: THREE.Vector3; radius: number; color: string }>();
    if (!dataset) return out;
    const colorById = new Map<string, string>();
    dataset.categories.forEach(c => colorById.set(c.id, c.color));

    const buckets = new Map<string, { x: number; y: number; z: number; n: number; pts: { x: number; y: number; z: number }[] }>();
    for (const p of dataset.points) {
      const b = buckets.get(p.category) ?? { x: 0, y: 0, z: 0, n: 0, pts: [] };
      b.x += p.x; b.y += p.y; b.z += p.z; b.n += 1;
      b.pts.push({ x: p.x, y: p.y, z: p.z });
      buckets.set(p.category, b);
    }
    for (const [cat, b] of buckets) {
      if (b.n === 0) continue;
      const cx = b.x / b.n, cy = b.y / b.n, cz = b.z / b.n;
      let maxR = 0;
      for (const p of b.pts) {
        const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (r > maxR) maxR = r;
      }
      out.set(cat, {
        centroid: new THREE.Vector3(cx, cy, cz),
        radius: Math.max(MIN_QUADRANT_RADIUS, maxR * QUADRANT_SCALE),
        color: colorById.get(cat) ?? '#94a3b8',
      });
    }
    return out;
  }, [dataset]);

  if ((!showRegionAxes && !phantomActive) || !dataset || activeMetric) return null;

  const visibleRegions = Array.from(regions.entries()).filter(
    ([cat]) => enabledCategories.has(cat) && COHORT_CAPTIONS[cat] !== undefined
  );

  // Pair arrows are reserved for the trajectory mode. The "Regions"
  // toggle alone shows only the quadrant highlights + captions.
  const visibleAxes = phantomActive
    ? COHORT_AXES.filter(a =>
        regions.has(a.from) && regions.has(a.to)
        && enabledCategories.has(a.from) && enabledCategories.has(a.to)
      )
    : [];

  const captionBg = isLight ? 'rgba(255, 252, 246, 0.85)' : 'rgba(4, 7, 17, 0.78)';
  const captionFg = isLight ? '#475569' : '#94a3b8';
  const captionBorder = isLight ? 'rgba(100, 116, 139, 0.25)' : 'rgba(148, 163, 184, 0.18)';
  const axisLineColor = isLight ? '#94a3b8' : '#64748b';
  const axisLabelBg = isLight ? 'rgba(255, 252, 246, 0.92)' : 'rgba(10, 14, 26, 0.88)';
  const axisLabelFg = isLight ? '#475569' : '#cbd5e1';

  return (
    <group>
      {/* Quadrant highlights — translucent color-matched sphere per
          cohort. Rendered behind the points (low opacity, depthWrite
          off) so the cluster + label sit on top. Only when the Regions
          toggle is explicitly on; the phantom-only mode skips these
          to keep the trajectory readable. */}
      {showRegionAxes && visibleRegions.map(([cat, region]) => (
        <mesh
          key={`quadrant-${cat}`}
          position={[region.centroid.x, region.centroid.y, region.centroid.z]}
        >
          <sphereGeometry args={[region.radius, 24, 24]} />
          <meshBasicMaterial
            color={region.color}
            transparent
            opacity={isLight ? 0.06 : 0.08}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Quadrant outline — thin wireframe sphere co-located with the
          translucent fill. The fill alone reads as fog; the wireframe
          gives the boundary just enough definition to register as a
          "zone of X" even at oblique camera angles. */}
      {showRegionAxes && visibleRegions.map(([cat, region]) => (
        <mesh
          key={`quadrant-outline-${cat}`}
          position={[region.centroid.x, region.centroid.y, region.centroid.z]}
        >
          <sphereGeometry args={[region.radius, 24, 16]} />
          <meshBasicMaterial
            color={region.color}
            wireframe
            transparent
            opacity={isLight ? 0.12 : 0.16}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Pair arrows — phantom-only. Thin native lines between cohort
          centroids with a midpoint caption describing what the direction
          means. */}
      {visibleAxes.map(axis => {
        const a = regions.get(axis.from)!.centroid;
        const b = regions.get(axis.to)!.centroid;
        const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
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
              position={[midpoint.x, midpoint.y, midpoint.z]}
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
      {visibleRegions.map(([cat, region]) => {
        const caption = COHORT_CAPTIONS[cat]!;
        return (
          <Html
            key={`caption-${cat}`}
            position={[region.centroid.x, region.centroid.y - 0.9, region.centroid.z]}
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
