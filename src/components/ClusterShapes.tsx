/**
 * ClusterShapes — per-category surface meshes, primitives picked by
 * `AtlasCategory.shape` and fit to the cluster via PCA.
 *
 * Replaces the legacy ClusterHulls (icosahedral direction sampling, same
 * topology for every cluster). Now each category renders as its assigned
 * primitive (ellipsoid / torus / ribbon / lattice / sphere / icosahedron),
 * scaled by 2σ half-axes and rotated so the primitive's local x matches
 * the cluster's major principal axis.
 *
 * Why per-frame opacity in useFrame instead of derived state:
 *   Hover changes opacity on the order of pointer events, not on the
 *   order of dataset changes. Bouncing through useMemo/useEffect would
 *   thrash. useFrame mutates the live material in place.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import { useDerivedState, type CategoryShape } from '../lib/use-derived';
import type { ClusterShapeKind } from '../schema/types';

// Tunable cosmetics ─────────────────────────────────────────────────────────
const FILL_OPACITY = 0.05;
const WIRE_OPACITY = 0.95;
// Halo wireframe — a slightly-scaled-up clone of the same wireframe stacked
// on top with additive blending. WebGL's `LineBasicMaterial.linewidth` is
// effectively ignored on most platforms, so we fake outline thickness by
// stacking two rasterized edge sets at slightly different scales. The
// overlap reads as a brighter, fatter outline without pulling in a thick-
// line dependency (drei `<Line>` / three-stdlib `LineSegments2`).
const HALO_OPACITY = 0.50;
const HALO_SCALE = 1.04;
const HOVER_FADE = 0.15;
const HOVER_AMP = 1.6;

/** Sphere primitive scaled by halfAxes → ellipsoid. */
const UNIT_SPHERE = new THREE.SphereGeometry(1, 32, 20);
/** Geometry shared by 'icosahedron' shape kind (12 verts / 20 faces). */
const UNIT_ICO = new THREE.IcosahedronGeometry(1, 0);
/** Sharp diamond — 6 verts / 8 faces. */
const UNIT_OCT = new THREE.OctahedronGeometry(1, 0);
/** 12-face crystal — 20 verts. */
const UNIT_DODEC = new THREE.DodecahedronGeometry(1, 0);

export default function ClusterShapes() {
  const { clusterShapes } = useDerivedState();
  const showHulls = useAtlasStore(s => s.showHulls);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);

  const items = useMemo(() => clusterShapes.map(buildItem), [clusterShapes]);

  const fillRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wireRefs = useRef<(THREE.LineSegments | null)[]>([]);
  const haloRefs = useRef<(THREE.LineSegments | null)[]>([]);

  useFrame(() => {
    items.forEach(({ category }, i) => {
      const fill = fillRefs.current[i];
      const wire = wireRefs.current[i];
      const halo = haloRefs.current[i];
      if (!fill || !wire || !halo) return;
      const enabled = enabledCategories.has(category.id);
      fill.visible = wire.visible = halo.visible = enabled;
      if (!enabled) return;
      let mult = 1;
      if (hoveredCategory && category.id !== hoveredCategory) mult = HOVER_FADE;
      else if (hoveredCategory && category.id === hoveredCategory) mult = HOVER_AMP;
      (fill.material as THREE.MeshBasicMaterial).opacity = FILL_OPACITY * mult;
      (wire.material as THREE.LineBasicMaterial).opacity = WIRE_OPACITY * mult;
      (halo.material as THREE.LineBasicMaterial).opacity = HALO_OPACITY * mult;
    });
  });

  if (!showHulls) return null;
  return (
    <group>
      {items.map(({ category, geom, wireGeom, haloWireGeom }, i) => {
        const handleClick = (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          setInspectedCategory(category.id);
        };
        return (
        <group
          key={category.id}
          onClick={handleClick}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'auto'; }}
        >
          <mesh ref={el => { fillRefs.current[i] = el; }} geometry={geom}>
            <meshBasicMaterial
              color={category.color}
              transparent
              opacity={FILL_OPACITY}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {/* Bright inner outline — the actual cluster boundary. */}
          <lineSegments ref={el => { wireRefs.current[i] = el; }} geometry={wireGeom}>
            <lineBasicMaterial
              color={category.color}
              transparent
              opacity={WIRE_OPACITY}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </lineSegments>
          {/* Halo: same wireframe scaled out ~4%, additively blended to
              fatten the visible outline (WebGL ignores linewidth). */}
          <lineSegments ref={el => { haloRefs.current[i] = el; }} geometry={haloWireGeom}>
            <lineBasicMaterial
              color={category.color}
              transparent
              opacity={HALO_OPACITY}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </lineSegments>
        </group>
        );
      })}
    </group>
  );
}

// ─────────────────────── per-item geometry assembly ────────────────────────
interface ShapeItem {
  category: CategoryShape['category'];
  geom: THREE.BufferGeometry;
  wireGeom: THREE.WireframeGeometry;
  /** Slightly-scaled-out clone of `wireGeom`; stacked for fake line thickness. */
  haloWireGeom: THREE.WireframeGeometry;
}

/**
 * Bake the cluster's centroid + PCA basis + half-axes directly into the
 * geometry buffer. We do this (instead of applying a Matrix4 on the
 * wrapping <group>) so the WireframeGeometry sees the transformed vertices
 * — wireframes are derived in object-local space, not world space.
 */
function buildItem({ category, shape }: CategoryShape): ShapeItem {
  const kind: ClusterShapeKind = category.shape ?? 'ellipsoid';
  const { centroid, basis, halfAxes } = shape;
  const [a, b, c] = halfAxes;

  let geom: THREE.BufferGeometry;
  let scale: [number, number, number] = [1, 1, 1];

  switch (kind) {
    case 'torus': {
      // Major radius = a; tube thickness scales with the minor axis c.
      const tube = Math.max(0.1 * a, c);
      geom = new THREE.TorusGeometry(a, tube, 14, 36);
      break;
    }
    case 'octahedron': {
      // Sharp 6-vertex diamond. Stretching along principal axes gives a
      // crystal that points along the major-axis direction.
      geom = UNIT_OCT.clone();
      scale = [a, b, c];
      break;
    }
    case 'dodecahedron': {
      // 12-face crystal. Visually distinct from octahedron at glance:
      // octahedron reads pointy, dodecahedron reads faceted-rounded.
      geom = UNIT_DODEC.clone();
      scale = [a, b, c];
      break;
    }
    case 'sphere': {
      const r = (a + b + c) / 3;
      geom = UNIT_SPHERE.clone();
      scale = [r, r, r];
      break;
    }
    case 'icosahedron': {
      const r = (a + b + c) / 3;
      geom = UNIT_ICO.clone();
      scale = [r, r, r];
      break;
    }
    case 'ellipsoid':
    default: {
      geom = UNIT_SPHERE.clone();
      scale = [a, b, c];
      break;
    }
  }

  geom.applyMatrix4(transform(centroid, basis, scale));

  // Halo: clone the *already-transformed* geom, scale up around the cluster
  // centroid (not the world origin — that would translate the shape, not
  // expand it). The halo's wireframe is what gives the outline its fake
  // thickness in the renderer above.
  const haloGeom = geom.clone();
  const [cxw, cyw, czw] = centroid;
  haloGeom.translate(-cxw, -cyw, -czw);
  haloGeom.scale(HALO_SCALE, HALO_SCALE, HALO_SCALE);
  haloGeom.translate(cxw, cyw, czw);

  return {
    category,
    geom,
    wireGeom: new THREE.WireframeGeometry(geom),
    haloWireGeom: new THREE.WireframeGeometry(haloGeom),
  };
}

/**
 * Build a local→world transform: scale(s) → rotate(basis as columns) →
 * translate(centroid). `basis` is stored row-major as principal axes;
 * column k of the rotation matrix should be basis[k] (the k-th principal
 * axis unit vector). three's Matrix4.set takes row-major args, so we
 * write basis[k][i] into row i, column k.
 */
function transform(
  centroid: [number, number, number],
  basis: [[number, number, number], [number, number, number], [number, number, number]],
  scale: [number, number, number],
): THREE.Matrix4 {
  const rot = new THREE.Matrix4().set(
    basis[0][0], basis[1][0], basis[2][0], 0,
    basis[0][1], basis[1][1], basis[2][1], 0,
    basis[0][2], basis[1][2], basis[2][2], 0,
    0,           0,           0,           1,
  );
  const scaleM = new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]);
  const trans = new THREE.Matrix4().makeTranslation(centroid[0], centroid[1], centroid[2]);
  // worldPoint = T · R · S · localPoint
  return trans.multiply(rot).multiply(scaleM);
}

