/**
 * MapperGraph — overlay visualizing topological connections between
 * categories. Each category gets a centroid sphere + glow ring; each
 * mapper edge is a line whose opacity reflects edge weight.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';

export default function MapperGraph() {
  const dataset = useAtlasStore(s => s.dataset);
  const showMapper = useAtlasStore(s => s.showMapper);
  const { distances } = useDerivedState();

  const { lines, nodes } = useMemo(() => {
    if (!dataset || !distances) return { lines: [], nodes: [] };
    const centroidFor = (id: string): [number, number, number] | null => {
      const cat = dataset.categories.find(c => c.id === id);
      if (cat?.position) return cat.position;
      return distances.centroids.get(id) ?? null;
    };

    const lines = (dataset.mapperEdges ?? []).map((edge, i) => {
      const a = centroidFor(edge.from);
      const b = centroidFor(edge.to);
      if (!a || !b) return null;
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...a),
        new THREE.Vector3(...b),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: (edge.weight ?? 0.5) * 0.22,
      });
      const line = new THREE.Line(geom, mat);
      return { key: `edge-${i}`, line };
    }).filter((l): l is NonNullable<typeof l> => l !== null);

    const nodes = dataset.categories.map(cat => {
      const pos = centroidFor(cat.id);
      if (!pos) return null;
      return { key: cat.id, color: cat.color, position: pos };
    }).filter((n): n is NonNullable<typeof n> => n !== null);

    return { lines, nodes };
  }, [dataset, distances]);

  if (!showMapper) return null;
  return (
    <group>
      {lines.map(({ key, line }) => (
        <primitive key={key} object={line} />
      ))}
      {nodes.map(({ key, color, position }) => (
        <group key={key} position={position}>
          <mesh>
            <sphereGeometry args={[0.16, 20, 20]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.28, 0.42, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.28} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
