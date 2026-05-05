/**
 * PointCloud — declarative R3F component rendering all dataset points as
 * an additively-blended particle system.
 *
 * Per-frame work (color updates for filter + hover) happens inside useFrame,
 * which is the R3F equivalent of the imperative requestAnimationFrame loop.
 * The geometry buffers are created once and mutated in place per frame —
 * recreating them every render would tank performance.
 */
import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlasStore } from '../store';

const SPRITE_TEXTURE = createGlowSprite();

export default function PointCloud() {
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);

  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);

  // Build geometry buffers once per dataset.
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

  // Per-frame: filter masking, hover modulation, size pulse.
  useFrame((state) => {
    if (!dataset || !pointsRef.current || !materialRef.current) return;
    const t = state.clock.getElapsedTime();
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;

    for (let i = 0; i < dataset.points.length; i++) {
      const p = dataset.points[i]!;
      const labelKey = `${p.category}::${p.label ?? ''}`;
      const passes = enabledCategories.has(p.category) && (!p.label || enabledLabels.has(labelKey));
      if (!passes) {
        colorAttr.array[i * 3 + 0] = 0;
        colorAttr.array[i * 3 + 1] = 0;
        colorAttr.array[i * 3 + 2] = 0;
        continue;
      }
      const base = categoryColors.get(p.category);
      if (!base) continue;
      let mult = 1.7;
      if (hoveredCategory && p.category !== hoveredCategory) mult = 0.22;
      else if (hoveredCategory && p.category === hoveredCategory) mult = 2.4;
      colorAttr.array[i * 3 + 0] = base.r * mult;
      colorAttr.array[i * 3 + 1] = base.g * mult;
      colorAttr.array[i * 3 + 2] = base.b * mult;
    }
    colorAttr.needsUpdate = true;

    materialRef.current.size = 0.38 + Math.sin(t * 0.8) * 0.02;
  });

  if (!dataset) return null;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.index == null) return;
    const point = dataset.points[e.index];
    if (point) setSelectedPoint(point);
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
        ref={materialRef}
        size={0.38}
        map={SPRITE_TEXTURE}
        vertexColors
        blending={THREE.AdditiveBlending}
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
