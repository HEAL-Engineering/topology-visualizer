/**
 * AtlasCanvas — the R3F <Canvas> root. Composes scene components and wires
 * up the camera + orbit controls.
 *
 * Drei's <OrbitControls> replaces the entire hand-rolled drag/zoom logic
 * from the artifact. autoRotate is bound to the store flag.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useAtlasStore } from '../store';
import PointCloud from './PointCloud';
import ClusterHulls from './ClusterHulls';
import GlobalHull from './GlobalHull';
import MapperGraph from './MapperGraph';
import Scenery from './Scenery';

export default function AtlasCanvas() {
  const autoRotate = useAtlasStore(s => s.autoRotate);

  return (
    <Canvas
      camera={{ position: [12, 6, 12], fov: 50, near: 0.1, far: 1000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
    >
      <Scenery />
      <PointCloud />
      <ClusterHulls />
      <GlobalHull />
      <MapperGraph />
      <OrbitControls
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.08}
        minDistance={6}
        maxDistance={45}
      />
    </Canvas>
  );
}
