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
import { useDerivedState } from '../lib/use-derived';
import { METRICS, normalizeMetric, readMetric } from '../data/metrics';
import { RAMPS, sampleRamp } from '../data/color-ramps';
import type { AtlasPoint } from '../schema/types';

const SPRITE_TEXTURE = createGlowSprite();

export default function PointCloud() {
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const activeRamp = useAtlasStore(s => s.activeRamp);
  const theme = useAtlasStore(s => s.theme);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);
  const setHoveredPoint = useAtlasStore(s => s.setHoveredPoint);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);
  const setInspectedSubIndex = useAtlasStore(s => s.setInspectedSubIndex);
  const { pointSubIndex } = useDerivedState();
  const isLight = theme === 'light';

  const pointsRef = useRef<THREE.Points>(null);
  const invalidate = useThree(s => s.invalidate);

  // Build geometry buffers once per dataset. Category colors are stored
  // at full saturation in both modes — light mode used to darken at this
  // step, but that flattened the dot vibrance. With NormalBlending and the
  // glow sprite's white core, vertex_color is what gets composited over
  // the paper bg at center, so we want it to land at full hue.
  //
  // `originalPositions` is kept alongside the live position buffer so the
  // filter effect below can NaN out filtered points (hides them AND makes
  // them un-raycastable) and later restore them when the filter flips on.
  const { geometry, categoryColors, originalPositions } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const categoryColors = new Map<string, THREE.Color>();
    if (!dataset) return { geometry, categoryColors, originalPositions: new Float32Array(0) };

    for (const cat of dataset.categories) {
      categoryColors.set(cat.id, new THREE.Color(cat.color));
    }

    const positions = new Float32Array(dataset.points.length * 3);
    const originalPositions = new Float32Array(dataset.points.length * 3);
    const colors = new Float32Array(dataset.points.length * 3);
    dataset.points.forEach((p, i) => {
      positions[i * 3 + 0] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      originalPositions[i * 3 + 0] = p.x;
      originalPositions[i * 3 + 1] = p.y;
      originalPositions[i * 3 + 2] = p.z;
      const c = categoryColors.get(p.category) ?? new THREE.Color('#888');
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geometry, categoryColors, originalPositions };
  }, [dataset]);

  // Filter masking + hover modulation + metric-lens recoloring. Runs only
  // when one of the dependent store values actually changes — not on every
  // animation frame.
  useEffect(() => {
    if (!dataset || !pointsRef.current) return;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const posArr = posAttr.array as Float32Array;
    const metricDef = activeMetric ? METRICS.find(m => m.key === activeMetric) ?? null : null;
    const rampStops = RAMPS[activeRamp].stops;
    const rampColor: [number, number, number] = [0, 0, 0];

    for (let i = 0; i < dataset.points.length; i++) {
      const p = dataset.points[i]!;
      const labelKey = `${p.category}::${p.label ?? ''}`;
      const passes = enabledCategories.has(p.category) && (!p.label || enabledLabels.has(labelKey));
      if (!passes) {
        // NaN positions: WebGL's clip-space test rejects them (point isn't
        // drawn) and three's Points.raycast computes a NaN distance which
        // never beats the hit threshold (point isn't clickable). Color is
        // also zeroed for completeness, but the NaN does the real work.
        arr[i * 3 + 0] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 0;
        posArr[i * 3 + 0] = NaN;
        posArr[i * 3 + 1] = NaN;
        posArr[i * 3 + 2] = NaN;
        continue;
      }
      // Restore the original position whenever a point flips back into the
      // visible set. Cheap unconditional write — costs nothing vs. checking
      // whether the position was previously NaN.
      posArr[i * 3 + 0] = originalPositions[i * 3 + 0]!;
      posArr[i * 3 + 1] = originalPositions[i * 3 + 1]!;
      posArr[i * 3 + 2] = originalPositions[i * 3 + 2]!;

      if (metricDef) {
        // Metric-lens mode: color by normalized metric value. Points lacking
        // the field fade to near-zero so the lens acts as a filter too.
        const raw = readMetric(p, metricDef.key);
        if (raw == null) {
          arr[i * 3 + 0] = 0.02; arr[i * 3 + 1] = 0.02; arr[i * 3 + 2] = 0.02;
          continue;
        }
        const t = normalizeMetric(metricDef, raw);
        sampleRamp(rampStops, t, rampColor);
        // Render every point at its ramp hue with no value-based brightness
        // scaling. Previously low-metric points were further darkened on top
        // of the already-dark ramp end, which collapsed contrast where it
        // mattered most. Hover modulation still applies because that's about
        // cohort comparison, not metric value.
        let mult = 1;
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
    posAttr.needsUpdate = true;
    // Bounding sphere is used by the frustum culler. After we NaN out some
    // positions, the cached sphere is stale and (more importantly) NaN-
    // contaminated, which can mark the whole Points object as culled or
    // throw a warning. Recompute so the visible subset bounds the draw.
    geometry.computeBoundingSphere();
    invalidate();
  }, [dataset, geometry, enabledCategories, enabledLabels, hoveredCategory, activeMetric, activeRamp, categoryColors, invalidate, isLight, originalPositions]);

  if (!dataset) return null;

  /**
   * Honor the filter panel when handling pointer events: a "hidden" point
   * is still in the geometry buffer (we just black out its color in the
   * recolor effect), so the raycaster will still hit it. Without this
   * guard, clicking where a filtered category appears empty would open
   * the EventCard/InspectPanel anyway.
   */
  const isPointVisible = (point: AtlasPoint): boolean => {
    if (!enabledCategories.has(point.category)) return false;
    const labelKey = `${point.category}::${point.label ?? ''}`;
    if (point.label && !enabledLabels.has(labelKey)) return false;
    return true;
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.index == null) return;
    const point = dataset.points[e.index];
    if (!point || !isPointVisible(point)) return;
    setSelectedPoint(point);
    // Surface the cluster's archetype reading (geometry / strengths /
    // action items) alongside the per-point detail so users connect the
    // individual data point with the topology of its containing cluster.
    // For categories that split into multiple lobes, page the panel to
    // the lobe this specific point belongs to.
    setInspectedCategory(point.category);
    const sub = pointSubIndex.get(point.id) ?? 0;
    if (sub !== 0) setInspectedSubIndex(sub);
  };

  /**
   * Pointer cursor reflects whether the hovered point is interactable, and
   * we publish the hovered point so the EventCard can render a transient
   * preview without requiring a click. Fires per-point as the cursor
   * moves across the cloud, so the cursor switches between `pointer` and
   * `default` (and `hoveredPoint` flips between live points and null) as
   * you sweep over a mix of filtered-in and filtered-out points.
   */
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.index == null) return;
    const point = dataset.points[e.index];
    const visible = !!point && isPointVisible(point);
    document.body.style.cursor = visible ? 'pointer' : 'default';
    setHoveredPoint(visible ? point : null);
  };

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
        setHoveredPoint(null);
      }}
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
//
// Resolution: 32x32. The sprite is a smooth radial blob with no high-
// frequency detail; bilinear-filtered sampling makes 32x32 visually
// indistinguishable from 128x128 while cutting texture cache pressure 16×.
function createGlowSprite(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const SIZE = 32;
  const HALF = SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(HALF, HALF, 0, HALF, HALF, HALF);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
