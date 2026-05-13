/**
 * Scenery — static atmospheric elements: starfield, grid floor, faint axes.
 *
 * Theme-aware. Dark mode keeps the original deep-space look with saturated
 * RGB axes and additive blending (the cluster colors glow against black).
 * Light mode swaps to a warm-paper background, gray axes, and Normal
 * blending — additive blending vanishes on a near-white background, so
 * the axes are switched to a plain `LineBasicMaterial` without additive
 * compositing.
 *
 * The fog and `<color attach="background">` are intentionally bound to the
 * same palette so the scene horizon dissolves smoothly into the canvas
 * background instead of cutting at the fog far-plane.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import type { Theme } from '../store';

type Palette = {
  bg: string;
  fog: string;
  gridMain: string;
  gridSub: string;
  star: string;
  starOpacity: number;
  axes: [number, number, number]; // X, Y, Z (hex numbers)
  axisBlending: THREE.Blending;
  axisOpacity: number;
};

const DARK_PALETTE: Palette = {
  bg: '#040711',
  fog: '#040711',
  gridMain: '#1a2238',
  gridSub: '#0c121e',
  star: '#8899bb',
  starOpacity: 0.5,
  axes: [0xff3366, 0x33ff77, 0x3377ff],
  axisBlending: THREE.AdditiveBlending,
  axisOpacity: 1.0,
};

const LIGHT_PALETTE: Palette = {
  // Warm paper — softer than pure white, less harsh against the glass UI.
  bg: '#f4f1ea',
  fog: '#e8e4da',
  // Grid: muted slate on warm paper. Main lines slightly darker than subs.
  gridMain: '#94a3b8',
  gridSub: '#cbd5e1',
  star: '#64748b',
  starOpacity: 0.25,
  // Three shades of slate gray — distinguishable but not chromatic.
  axes: [0x94a3b8, 0x64748b, 0x475569],
  // Additive blending is invisible on a near-white background (it can only
  // brighten, and the bg is already near max). Use NormalBlending so the
  // axis lines actually subtract value.
  axisBlending: THREE.NormalBlending,
  axisOpacity: 0.85,
};

function paletteFor(theme: Theme): Palette {
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

export default function Scenery() {
  const theme = useAtlasStore(s => s.theme);
  const palette = paletteFor(theme);

  const starGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // 200 stars vs the original 800 — they sit on a 60–90 unit shell well
    // outside the cluster mass, decorative only. Most never enter the
    // viewport at normal orbit distances; cutting them is invisible.
    const count = 200;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 60 + Math.random() * 30;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);

  // Axes are rebuilt when the palette changes so blending mode and color
  // swap without leaking the old material. Memo key is the theme string —
  // palette object identity is stable per theme.
  // Axes extended from ±6 to ±40 to match the wider grid; fog (far=50)
  // fades the tips so they don't read as hard line ends.
  const axisLines = useMemo(() => {
    const AXIS_HALF = 40;
    const axes = [
      { pts: [new THREE.Vector3(-AXIS_HALF, 0, 0), new THREE.Vector3(AXIS_HALF, 0, 0)], color: palette.axes[0] },
      { pts: [new THREE.Vector3(0, -AXIS_HALF, 0), new THREE.Vector3(0, AXIS_HALF, 0)], color: palette.axes[1] },
      { pts: [new THREE.Vector3(0, 0, -AXIS_HALF), new THREE.Vector3(0, 0, AXIS_HALF)], color: palette.axes[2] },
    ];
    return axes.map(({ pts, color }) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: palette.axisOpacity,
        blending: palette.axisBlending,
        depthWrite: false,
        toneMapped: false,
      });
      return new THREE.Line(g, m);
    });
  }, [palette]);

  return (
    <>
      <points geometry={starGeom}>
        <pointsMaterial color={palette.star} size={0.05} transparent opacity={palette.starOpacity} />
      </points>
      {/* Grid extended from 22→80 units (still 1 unit/cell) so the floor
          reaches well past the camera's idle frustum and the markings
          remain visible while orbiting wide of the data. The fog far-plane
          (50 units) softly dissolves the outermost ring so it doesn't read
          as a hard square edge. */}
      <gridHelper args={[80, 80, palette.gridMain, palette.gridSub]} position={[0, -5.2, 0]} />
      {axisLines.map((ln, i) => (
        <primitive key={`${theme}-${i}`} object={ln} />
      ))}
      <fog attach="fog" args={[palette.fog, 8, 50]} />
      <color attach="background" args={[palette.bg]} />
    </>
  );
}
