/**
 * GlobalHull — single convex hull wrapping all currently-filtered points.
 * Geometry rebuilds when the filter set changes.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';

export default function GlobalHull() {
  const dataset = useAtlasStore(s => s.dataset);
  const showGlobalHull = useAtlasStore(s => s.showGlobalHull);
  const { globalHull } = useDerivedState();

  const { fillGeom, wireGeom } = useMemo(() => {
    if (!dataset || globalHull.length === 0) return { fillGeom: null, wireGeom: null };
    const positions = new Float32Array(dataset.points.length * 3);
    dataset.points.forEach((p, i) => {
      positions[i * 3 + 0] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });
    const indices = new Uint16Array(globalHull.length * 3);
    globalHull.forEach((face, fi) => {
      indices[fi * 3 + 0] = face[0];
      indices[fi * 3 + 1] = face[1];
      indices[fi * 3 + 2] = face[2];
    });
    const fillGeom = new THREE.BufferGeometry();
    fillGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    fillGeom.setIndex(new THREE.BufferAttribute(indices, 1));
    fillGeom.computeVertexNormals();
    const wireGeom = new THREE.WireframeGeometry(fillGeom);
    return { fillGeom, wireGeom };
  }, [dataset, globalHull]);

  if (!showGlobalHull || !fillGeom || !wireGeom) return null;
  return (
    <group>
      <mesh geometry={fillGeom}>
        <meshBasicMaterial
          color="#a8c4e8"
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={wireGeom}>
        <lineBasicMaterial
          color="#b8d4f0"
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}
