/**
 * App — top-level composition. Starts empty; the user populates the atlas by
 * dropping a JSON/CSV file via the DataLoader. The Canvas (3D scene) sits in
 * the background; UI overlays float above with pointer-events: auto where
 * interactive.
 */
import AtlasCanvas from './components/AtlasCanvas';
import ControlBar from './components/ControlBar';
import FilterPanel from './components/FilterPanel';
import TablePanel from './components/TablePanel';
import EventCard from './components/EventCard';
import DataLoader from './components/DataLoader';

export default function App() {
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
