/**
 * Scenery — static atmospheric elements: starfield, grid floor, faint axes.
 * No filter or hover reactivity; rendered once.
 */
import { useMemo } from 'react';
import * as THREE from 'three';

export default function Scenery() {
  const starGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = 800;
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

  const axisLines = useMemo(() => {
    const points = [
      [new THREE.Vector3(-6, 0, 0), new THREE.Vector3(6, 0, 0)],
      [new THREE.Vector3(0, -6, 0), new THREE.Vector3(0, 6, 0)],
      [new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, 0, 6)],
    ];
    return points.map(pts => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineBasicMaterial({ color: 0x223355, transparent: true, opacity: 0.35 });
      return new THREE.Line(g, m);
    });
  }, []);

  return (
    <>
      <points geometry={starGeom}>
        <pointsMaterial color="#8899bb" size={0.05} transparent opacity={0.5} />
      </points>
      <gridHelper args={[22, 22, '#1a2238', '#0c121e']} position={[0, -5.2, 0]} />
      {axisLines.map((ln, i) => (
        <primitive key={i} object={ln} />
      ))}
      <fog attach="fog" args={['#040711', 8, 50]} />
      <color attach="background" args={['#040711']} />
    </>
  );
}
