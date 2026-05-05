/**
 * App — top-level composition. Loads a synthetic sample on mount, then lets
 * the user replace it via the DataLoader. The Canvas (3D scene) sits in the
 * background; UI overlays float above with pointer-events: auto where
 * interactive.
 */
import { useEffect } from 'react';
import { useAtlasStore } from './store';
import { generateSyntheticDataset } from './data/synthetic';
import AtlasCanvas from './components/AtlasCanvas';
import ControlBar from './components/ControlBar';
import FilterPanel from './components/FilterPanel';
import TablePanel from './components/TablePanel';
import EventCard from './components/EventCard';
import DataLoader from './components/DataLoader';

export default function App() {
  const dataset = useAtlasStore(s => s.dataset);
  const setDataset = useAtlasStore(s => s.setDataset);
  const resetFilters = useAtlasStore(s => s.resetFilters);

  // Boot with a synthetic dataset so the app has something to show on first load.
  useEffect(() => {
    if (dataset) return;
    const sample = generateSyntheticDataset(640, 1729);
    setDataset(sample);
    const allLabels: string[] = [];
    for (const p of sample.points) {
      if (p.label) allLabels.push(`${p.category}::${p.label}`);
    }
    resetFilters(sample.categories.map(c => c.id), allLabels);
  }, [dataset, setDataset, resetFilters]);

  return (
    <div className="w-full h-screen relative overflow-hidden bg-[#040711]">
      <AtlasCanvas />
      <ControlBar />
      <DataLoader />
      <FilterPanel />
      <TablePanel />
      <EventCard />

      {/* Bottom-center hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-[10px] tracking-[0.32em] text-slate-600 uppercase pointer-events-none font-mono">
        Drag to rotate · Scroll to zoom · Click point to inspect
      </div>

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(4,7,17,0.6) 100%)' }}
      />
    </div>
  );
}
