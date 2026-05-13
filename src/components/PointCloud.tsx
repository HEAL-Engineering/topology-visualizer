/**
 * PointCloud — declarative R3F component rendering all dataset points as
 * an additively-blended particle system.
 *
 * Color updates (filter masking + hover modulation) are pushed via a
 * useEffect keyed on the relevant store state, *not* useFrame. Mutating the
 * color buffer 60×/sec when nothing has changed was the largest single CPU
 * sink in the scene — moving it to event-driven updates lets the demand
 * frameloop in AtlasCanvas idle to ~0% GPU when the user isn't interacting.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import { METRICS, normalizeMetric, readMetric } from '../data/metrics';

const SPRITE_TEXTURE = createGlowSprite();

/**
 * Viridis-inspired ramp keyed at six stops along normalized [0, 1]. Sampled
 * on demand by lerping between adjacent stops — cheap, no LUT allocation.
 * Same gradient as the Legend stripe in MetricLens, so the panel reads as
 * the literal key to the colors on screen.
 */
const RAMP_STOPS: Array<[number, [number, number, number]]> = [
  [0.00, [0.12, 0.23, 0.54]],  // #1e3a8a
  [0.20, [0.02, 0.71, 0.83]],  // #06b6d4
  [0.40, [0.52, 0.80, 0.09]],  // #84cc16
  [0.60, [0.98, 0.80, 0.08]],  // #facc15
  [0.80, [0.98, 0.45, 0.09]],  // #f97316
  [1.00, [0.86, 0.15, 0.15]],  // #dc2626
];
function sampleRamp(t: number, out: [number, number, number]) {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 0; i < RAMP_STOPS.length - 1; i++) {
    const [a, ca] = RAMP_STOPS[i]!;
    const [b, cb] = RAMP_STOPS[i + 1]!;
    if (c <= b) {
      const u = (c - a) / (b - a);
      out[0] = ca[0] + (cb[0] - ca[0]) * u;
      out[1] = ca[1] + (cb[1] - ca[1]) * u;
      out[2] = ca[2] + (cb[2] - ca[2]) * u;
      return;
    }
  }
  out[0] = 0.86; out[1] = 0.15; out[2] = 0.15;
}

export default function PointCloud() {
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const theme = useAtlasStore(s => s.theme);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);
  const isLight = theme === 'light';

  const pointsRef = useRef<THREE.Points>(null);
  const invalidate = useThree(s => s.invalidate);

  // Build geometry buffers once per dataset. Category colors are stored
  // at full saturation in both modes — light mode used to darken at this
  // step, but that flattened the dot vibrance. With NormalBlending and the
  // glow sprite's white core, vertex_color is what gets composited over
  // the paper bg at center, so we want it to land at full hue.
  const { geometry, categoryColors } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const categoryColors = new Map<string, THREE.Color>();
    if (!dataset) return { geometry, categoryColors };

    for (const cat of dataset.categories) {
      categoryColors.set(cat.id, new THREE.Color(cat.color));
    }

    const positions = new Float32Array(dataset.points.length * 3);
    const colors = new Float32Array(dataset.points.length * 3);
    dataset.points.forEach((p, i) => {
      positions[i * 3 + 0] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      const c = categoryColors.get(p.category) ?? new THREE.Color('#888');
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geometry, categoryColors };
  }, [dataset]);

  // Filter masking + hover modulation + metric-lens recoloring. Runs only
  // when one of the dependent store values actually changes — not on every
  // animation frame.
  useEffect(() => {
    if (!dataset || !pointsRef.current) return;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const metricDef = activeMetric ? METRICS.find(m => m.key === activeMetric) ?? null : null;
    const rampColor: [number, number, number] = [0, 0, 0];

    for (let i = 0; i < dataset.points.length; i++) {
      const p = dataset.points[i]!;
      const labelKey = `${p.category}::${p.label ?? ''}`;
      const passes = enabledCategories.has(p.category) && (!p.label || enabledLabels.has(labelKey));
      if (!passes) {
        arr[i * 3 + 0] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 0;
        continue;
      }

      if (metricDef) {
        // Metric-lens mode: color by normalized metric value. Points lacking
        // the field fade to near-zero so the lens acts as a filter too.
        const raw = readMetric(p, metricDef.key);
        if (raw == null) {
          arr[i * 3 + 0] = 0.02; arr[i * 3 + 1] = 0.02; arr[i * 3 + 2] = 0.02;
          continue;
        }
        const t = normalizeMetric(metricDef, raw);
        sampleRamp(t, rampColor);
        // Brightness floor so even "low" points are still visible; hovered
        // category gets a slight amp so the user can compare metric values
        // within one cohort against another. The user-cluster brightness
        // boost is intentionally NOT applied here — lens mode strips all
        // category-specific styling so colors read purely as metric values.
        let mult = 0.85 + t * 0.6;
        if (hoveredCategory && p.category !== hoveredCategory) mult *= 0.25;
        else if (hoveredCategory && p.category === hoveredCategory) mult *= 1.4;
        arr[i * 3 + 0] = rampColor[0] * mult;
        arr[i * 3 + 1] = rampColor[1] * mult;
        arr[i * 3 + 2] = rampColor[2] * mult;
        continue;
      }

      const base = categoryColors.get(p.category);
      if (!base) continue;
      // Default multiplier reduced so cluster outlines (the new "primary"
      // visual layer) dominate; points sit underneath as a soft swarm.
      // User points are the user's *own* data — bumped well above prototype
      // brightness so they read as the focal swarm in the scene.
      //
      // Light-mode multipliers stay <= 1 because the material switches to
      // NormalBlending below — values above 1 don't add brightness, they
      // just clamp at full color and wash out against the paper bg. The
      // hover modulation still differentiates categories via opacity-feel
      // rather than overdrive.
      const isUserPt = p.category === 'user';
      let mult = isUserPt ? (isLight ? 1.0 : 1.5) : (isLight ? 0.75 : 0.7);
      if (hoveredCategory && p.category !== hoveredCategory) {
        mult = isLight ? 0.35 : 0.15;
      } else if (hoveredCategory && p.category === hoveredCategory) {
        mult = isLight ? 1.0 : (isUserPt ? 2.4 : 1.8);
      }
      arr[i * 3 + 0] = base.r * mult;
      arr[i * 3 + 1] = base.g * mult;
      arr[i * 3 + 2] = base.b * mult;
    }
    colorAttr.needsUpdate = true;
    invalidate();
  }, [dataset, geometry, enabledCategories, enabledLabels, hoveredCategory, activeMetric, categoryColors, invalidate, isLight]);

  if (!dataset) return null;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.index == null) return;
    const point = dataset.points[e.index];
    if (point) {
      setSelectedPoint(point);
      // Surface the cluster's archetype reading (geometry / strengths /
      // action items) alongside the per-point detail so users connect the
      // individual data point with the topology of its containing cluster.
      setInspectedCategory(point.category);
    }
  };

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'default'; }}
      raycast={(rc, intersects) => {
        rc.params.Points!.threshold = 0.22;
        THREE.Points.prototype.raycast.call(pointsRef.current!, rc, intersects);
      }}
    >
      <pointsMaterial
        // `key` forces a fresh material instance on theme change so the
        // blending switch (Additive ↔ Normal) takes effect — three caches
        // some material state internally and updating `blending` alone
        // doesn't always recompile the shader correctly.
        key={isLight ? 'light' : 'dark'}
        size={isLight ? 0.32 : 0.26}
        map={SPRITE_TEXTURE}
        vertexColors
        // Additive blending on the dark scene adds the point's color to the
        // near-black bg → glow. On the light-mode paper bg, additive can
        // only brighten (already near-white), so points vanish. Normal
        // blending lets the sprite's alpha composite the darkened category
        // colors *over* the paper, which is the only way they read.
        blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
        transparent
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// Soft radial glow sprite for additive blending. Same gradient stops we
// landed on in the artifact: bright core through 32% radius, falloff to 0.
function createGlowSprite(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
