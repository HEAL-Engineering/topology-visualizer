/**
 * PhantomTrajectory — renders the "could-be" projection alongside the
 * existing point cloud. Three visual layers, all keyed off the store's
 * `phantomTrajectory` + `showPhantom`:
 *
 *   1. Ghost points        — phantom positions drawn as ring sprites,
 *                            pulsing gently so they read as projected /
 *                            non-real vs the solid points of actual data.
 *   2. Dashed cluster shape — wireframe of the target's primitive (octa-
 *                            hedron / dodecahedron) PCA-fit to the phantom
 *                            points. Renders the could-be topology.
 *   3. Trajectory arrow    — dashed line from the user's actual centroid
 *                            to the phantom centroid, communicating the
 *                            *direction* of movement, not just the goal.
 *
 * The component is a no-op when `phantomTrajectory` is null or `show-
 * Phantom` is false. It owns all of its own sprite/material lifecycles
 * and disposes them when the trajectory swaps or unmounts.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useAtlasStore } from '../store';

const RING_SPRITE = createRingSprite();

/** Reused unit primitives for the phantom shape — keyed off `category.shape`. */
const UNIT_OCT = new THREE.OctahedronGeometry(1, 0);
const UNIT_DODEC = new THREE.DodecahedronGeometry(1, 0);
const UNIT_ICO = new THREE.IcosahedronGeometry(1, 0);
const UNIT_SPHERE = new THREE.SphereGeometry(1, 32, 20);

const PULSE_PERIOD_S = 2.2;

export default function PhantomTrajectory() {
  const activeKey = useAtlasStore(s => s.activePhantomKey);
  const phantomCache = useAtlasStore(s => s.phantomCache);
  const showPhantom = useAtlasStore(s => s.showPhantom);
  const theme = useAtlasStore(s => s.theme);
  const isLight = theme === 'light';
  // Resolve which cached projection (if any) to draw. The renderer is a
  // pure consumer here — generation lives in `usePhantomPrecompute` /
  // re-roll actions in PhantomSection.
  const phantom = activeKey ? phantomCache[activeKey] ?? null : null;

  // Build the phantom point geometry (positions + per-vertex color buffer).
  // Recomputed whenever the trajectory swaps; small (≤ ~50 verts), cheap.
  const pointsGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (!phantom) return g;
    const positions = new Float32Array(phantom.points.length * 3);
    phantom.points.forEach((p, i) => {
      positions[i * 3 + 0] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [phantom]);

  // Phantom shape wireframe — uses the *target's* primitive, PCA-fit to
  // the phantom point cluster. Solid `LineBasicMaterial` rather than
  // dashed because LineDashedMaterial requires per-vertex `lineDistances`
  // and a `computeLineDistances()` pass per frame for line segments
  // generated from WireframeGeometry; cheaper to fake "ghost" with low
  // opacity + the pulsing alpha tied to the points.
  const shapeGeom = useMemo(() => {
    if (!phantom) return null;
    const kind = phantom.category.shape ?? 'octahedron';
    let geom: THREE.BufferGeometry;
    let scale: [number, number, number] = [1, 1, 1];
    const [a, b, c] = phantom.shape.halfAxes;
    switch (kind) {
      case 'octahedron':   geom = UNIT_OCT.clone();   scale = [a, b, c]; break;
      case 'dodecahedron': geom = UNIT_DODEC.clone(); scale = [a, b, c]; break;
      case 'icosahedron': {
        const r = (a + b + c) / 3;
        geom = UNIT_ICO.clone(); scale = [r, r, r]; break;
      }
      case 'sphere': {
        const r = (a + b + c) / 3;
        geom = UNIT_SPHERE.clone(); scale = [r, r, r]; break;
      }
      default: geom = UNIT_SPHERE.clone(); scale = [a, b, c]; break;
    }
    geom.applyMatrix4(transform(phantom.shape.centroid, phantom.shape.basis, scale));
    const wire = new THREE.WireframeGeometry(geom);
    geom.dispose();
    return wire;
  }, [phantom]);

  // Trajectory arrow geometry: a single segment user→phantom centroid.
  const arrowGeom = useMemo(() => {
    if (!phantom) return null;
    const [ux, uy, uz] = phantom.userCentroid;
    const [px, py, pz] = phantom.shape.centroid;
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ux, uy, uz),
      new THREE.Vector3(px, py, pz),
    ]);
    return g;
  }, [phantom]);

  // Dispose of geometries when the trajectory changes — useMemo doesn't
  // clean up the prior return value, and these are GPU-resident buffers.
  useEffect(() => {
    return () => {
      pointsGeom.dispose();
      shapeGeom?.dispose();
      arrowGeom?.dispose();
    };
  }, [pointsGeom, shapeGeom, arrowGeom]);

  const pointsMatRef = useRef<THREE.PointsMaterial>(null);
  const shapeMatRef = useRef<THREE.LineBasicMaterial>(null);
  const arrowMatRef = useRef<THREE.LineDashedMaterial>(null);
  const arrowSegRef = useRef<THREE.LineSegments>(null);

  // Compute line dashes once the arrow geometry exists; LineDashedMaterial
  // needs per-vertex distances or the dash pattern doesn't render. Using
  // LineSegments (not Line) because TS treats lowercase `<line>` as the
  // SVG element — the R3F intrinsic is ambiguous in JSX.
  useEffect(() => {
    if (arrowSegRef.current && arrowGeom) {
      arrowSegRef.current.computeLineDistances();
    }
  }, [arrowGeom]);

  // Pulse the phantom opacity so it visibly reads as "projected, not real".
  // Period is slow enough not to feel jittery; amplitude small so the user
  // never loses track of it during the dim phase.
  useFrame(({ clock }) => {
    if (!showPhantom || !phantom) return;
    const t = (clock.getElapsedTime() % PULSE_PERIOD_S) / PULSE_PERIOD_S;
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
    if (pointsMatRef.current) pointsMatRef.current.opacity = pulse;
    if (shapeMatRef.current) shapeMatRef.current.opacity = 0.35 + 0.35 * pulse;
    if (arrowMatRef.current) arrowMatRef.current.opacity = 0.4 + 0.4 * pulse;
  });

  if (!phantom || !showPhantom) return null;

  const phantomColor = phantom.category.color;
  const [px, py, pz] = phantom.shape.centroid;
  // Lift the label above the cluster along the major principal axis so it
  // sits clear of the wireframe.
  const labelLift = phantom.shape.halfAxes[0] * 1.25;

  return (
    <group>
      <points geometry={pointsGeom}>
        <pointsMaterial
          ref={pointsMatRef}
          size={isLight ? 0.42 : 0.36}
          map={RING_SPRITE}
          color={phantomColor}
          transparent
          opacity={0.7}
          blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {shapeGeom && (
        <lineSegments geometry={shapeGeom}>
          <lineBasicMaterial
            ref={shapeMatRef}
            color={phantomColor}
            transparent
            opacity={0.55}
            blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {arrowGeom && (
        <lineSegments ref={arrowSegRef} geometry={arrowGeom}>
          <lineDashedMaterial
            ref={arrowMatRef}
            color={phantomColor}
            dashSize={0.4}
            gapSize={0.25}
            transparent
            opacity={0.6}
            depthWrite={false}
          />
        </lineSegments>
      )}

      <Html
        position={[px, py + labelLift, pz]}
        center
        distanceFactor={12}
        occlude={false}
        style={{ pointerEvents: 'none' }}
        zIndexRange={[4, 0]}
      >
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            padding: '4px 9px',
            background: isLight ? 'rgba(255,252,246,0.92)' : 'rgba(4,7,17,0.85)',
            color: phantomColor,
            border: `1px dashed ${phantomColor}aa`,
            borderRadius: 2,
            boxShadow: isLight
              ? `0 2px 10px ${phantomColor}33`
              : `0 0 14px ${phantomColor}44`,
            userSelect: 'none',
          }}
          title="Projected topology if you follow every action item"
        >
          <span>Could be</span>
          <span style={{ marginLeft: 6, opacity: 0.55, fontSize: 9 }}>
            · {phantom.points.length} pts
          </span>
        </div>
      </Html>
    </group>
  );
}

/**
 * Ring sprite — bright hollow circle, falls to transparent on both sides.
 * Drawn into a 128×128 canvas once at module init; cheaper than per-frame
 * shader work and the pixel count is small enough not to look aliased
 * even when zoomed in.
 */
function createRingSprite(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(64, 64, 36, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Same local→world transform used by ClusterShapes (centroid + PCA basis
 * + scale baked into the geometry buffer). Inlined here so phantom
 * rendering doesn't depend on ClusterShapes' private helper.
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
  return trans.multiply(rot).multiply(scaleM);
}
