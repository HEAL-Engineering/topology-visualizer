/**
 * ClusterHulls — per-category icosahedral hulls. Visibility responds to
 * the category filter; opacity responds to legend hover.
 */
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';

export default function ClusterHulls() {
  const { clusterHulls } = useDerivedState();
  const showHulls = useAtlasStore(s => s.showHulls);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);

  const meshes = useMemo(() => {
    return clusterHulls.map(({ category, hull }) => {
      if (!hull) return null;
      const positions = new Float32Array(hull.vertices.flat());
      const indices = new Uint16Array(hull.faces.flat());
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setIndex(new THREE.BufferAttribute(indices, 1));
      geom.computeVertexNormals();
      const wireGeom = new THREE.WireframeGeometry(geom);
      return { category, geom, wireGeom };
    }).filter((m): m is NonNullable<typeof m> => m !== null);
  }, [clusterHulls]);

  // Opacity modulation per frame for hover-fade.
  useFrame(() => {
    meshes.forEach(({ category }, i) => {
      const fillRef = fillRefs.current[i];
      const wireRef = wireRefs.current[i];
      if (!fillRef || !wireRef) return;
      const enabled = enabledCategories.has(category.id);
      fillRef.visible = wireRef.visible = enabled;
      if (!enabled) return;
      const baseFill = 0.10;
      const baseWire = 0.55;
      let mult = 1;
      if (hoveredCategory && category.id !== hoveredCategory) mult = 0.15;
      else if (hoveredCategory && category.id === hoveredCategory) mult = 1.6;
      (fillRef.material as THREE.MeshBasicMaterial).opacity = baseFill * mult;
      (wireRef.material as THREE.LineBasicMaterial).opacity = baseWire * mult;
    });
  });

  const fillRefs = useMemo(() => ({ current: [] as (THREE.Mesh | null)[] }), [meshes]);
  const wireRefs = useMemo(() => ({ current: [] as (THREE.LineSegments | null)[] }), [meshes]);

  if (!showHulls) return null;
  return (
    <group>
      {meshes.map(({ category, geom, wireGeom }, i) => (
        <group key={category.id}>
          <mesh ref={(el) => { fillRefs.current[i] = el; }} geometry={geom}>
            <meshBasicMaterial
              color={category.color}
              transparent
              opacity={0.10}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments ref={(el) => { wireRefs.current[i] = el; }} geometry={wireGeom}>
            <lineBasicMaterial
              color={category.color}
              transparent
              opacity={0.55}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}
