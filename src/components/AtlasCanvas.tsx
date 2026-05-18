/**
 * AtlasCanvas — the R3F <Canvas> root. Composes scene components and wires
 * up the camera + orbit controls.
 *
 * Drei's <OrbitControls> replaces the entire hand-rolled drag/zoom logic
 * from the artifact. autoRotate is bound to the store flag, with a
 * keyboard "hold space to pause" override layered on top.
 */
import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import PointCloud from './PointCloud';
import ClusterShapes from './ClusterShapes';
import ClusterLabels from './ClusterLabels';
import PhantomTrajectory from './PhantomTrajectory';
import RegionAxes from './RegionAxes';
import Scenery from './Scenery';

export default function AtlasCanvas() {
  const autoRotate = useAtlasStore(s => s.autoRotate);
  const showPhantom = useAtlasStore(s => s.showPhantom);
  const activePhantomKey = useAtlasStore(s => s.activePhantomKey);
  const spaceHeld = useSpacebarHold();

  // Render only when something changes. OrbitControls with damping requests
  // its own renders during interaction; autoRotate needs the always-on loop
  // because it animates without any pointer input. We flip back to demand
  // the moment auto-rotate is paused so an idle scene costs ~0 GPU.
  const rotating = autoRotate && !spaceHeld;
  // Phantom trajectory pulses opacity via useFrame, so it also needs the
  // always-on loop while visible. Independent from autoRotate.
  const phantomAnimating = showPhantom && activePhantomKey !== null;
  const continuous = rotating || phantomAnimating;

  return (
    <Canvas
      camera={{ position: [12, 6, 12], fov: 50, near: 0.1, far: 1000 }}
      // Cap DPR at 1.5 — on Retina (devicePixelRatio=2) this halves the
      // shaded fragment count, the single biggest GPU win for this scene
      // since additive blends produce heavy overdraw.
      dpr={[1, 1.5]}
      // antialias: false — MSAA at 4× samples × 1.5 dpr × heavy additive
      // overdraw was the dominant per-frame fragment cost. Additive sprite
      // edges self-soften, so the visual delta is negligible while the
      // shading load drops by ~half during orbit.
      gl={{ antialias: false, alpha: false }}
      frameloop={continuous ? 'always' : 'demand'}
    >
      <Scenery />
      <PointCloud />
      <ClusterShapes />
      <ClusterLabels />
      <RegionAxes />
      <PhantomTrajectory />
      <OrbitControls
        makeDefault
        autoRotate={rotating}
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={200}
      />
      <CameraFit />
      <StoreInvalidator />
    </Canvas>
  );
}

/**
 * Bridges store-driven scene mutations (filter toggles, hover changes,
 * inspect-panel selection) into the R3F render scheduler. Without this,
 * the demand frameloop would never repaint on a filter toggle — the scene
 * would freeze on the last rendered frame until the user nudged orbit.
 *
 * Subscribes via store selectors (cheap; no re-render on unrelated state)
 * and pokes `invalidate()` once per change.
 */
function StoreInvalidator() {
  const invalidate = useThree(s => s.invalidate);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const selectedPoint = useAtlasStore(s => s.selectedPoint);
  const hoveredPoint = useAtlasStore(s => s.hoveredPoint);
  const showHulls = useAtlasStore(s => s.showHulls);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const theme = useAtlasStore(s => s.theme);
  const dataset = useAtlasStore(s => s.dataset);
  const phantomCache = useAtlasStore(s => s.phantomCache);
  const activePhantomKey = useAtlasStore(s => s.activePhantomKey);
  const showPhantom = useAtlasStore(s => s.showPhantom);

  useEffect(() => {
    invalidate();
  }, [invalidate, enabledCategories, enabledLabels, hoveredCategory,
      selectedPoint, hoveredPoint, showHulls, activeMetric, theme, dataset,
      phantomCache, activePhantomKey, showPhantom]);

  return null;
}

/**
 * Frames the camera around the loaded point cloud once per dataset.
 * Without this, the hard-coded starting position misses datasets whose
 * coordinate range differs from the sample's ~±3 span.
 *
 * Refits exactly when a *new* dataset settles — keyed off `datasetEpoch`,
 * which is bumped only by `setDataset` (full-load semantics). Point
 * mutations from logging training behaviors, removing injected points,
 * etc. leave the epoch unchanged so the user's current camera framing
 * is preserved. Otherwise every "log meal" click would yank the view.
 */
function CameraFit() {
  const datasetEpoch = useAtlasStore(s => s.datasetEpoch);
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  const fittedEpochRef = useRef<number>(-1);

  useEffect(() => {
    if (fittedEpochRef.current === datasetEpoch) return;
    // Snapshot the points at the moment the new epoch lands. Read once
    // here rather than subscribing so subsequent point mutations don't
    // re-trigger this effect.
    const points = useAtlasStore.getState().dataset?.points;
    if (!points || points.length === 0) return;

    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const p of points) box.expandByPoint(v.set(p.x, p.y, p.z));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    const persp = camera as THREE.PerspectiveCamera;
    const fov = persp.fov * (Math.PI / 180);
    const dist = (radius / Math.tan(fov / 2)) * 2.2;
    const dir = new THREE.Vector3(1, 0.55, 1).normalize();
    persp.position.copy(center).addScaledVector(dir, dist);
    persp.near = Math.max(0.01, dist * 0.01);
    persp.far = dist * 20;
    persp.updateProjectionMatrix();
    persp.lookAt(center);

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    fittedEpochRef.current = datasetEpoch;
  }, [datasetEpoch, camera, controls]);

  return null;
}

/**
 * Track whether the spacebar is held. Releasing toggles back off so auto-
 * rotate resumes whatever the store flag says (i.e. it's a transient
 * pause, not a permanent toggle — the Orbit button still owns the
 * persistent setting).
 *
 * Edge cases:
 *   - Typing in INPUT / TEXTAREA / contenteditable: space passes through
 *     to the input as a literal space character (we don't preventDefault).
 *   - Window blur (alt-tab while holding): we'd never see the keyup, so
 *     we reset the held state on blur to avoid a "stuck space" bug.
 *   - preventDefault on keydown stops the browser's default space-scroll
 *     behavior when the user isn't typing.
 */
function useSpacebarHold(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const isTypingTarget = (el: Element | null) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (el as HTMLElement).isContentEditable;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      if (!e.repeat) setHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setHeld(false);
    };
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return held;
}
