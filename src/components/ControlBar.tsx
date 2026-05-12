import { RotateCw, Box, Globe, Table, Info } from 'lucide-react';
import { useAtlasStore } from '../store';

type Props = { onOpenTopology: () => void };

const BTN_CLASS_BASE = 'px-3.5 py-2 text-[10px] tracking-[0.22em] uppercase border transition-all font-mono';
const BTN_CLASS_ON = 'border-emerald-400/40 text-emerald-300 bg-emerald-500/[0.04]';
const BTN_CLASS_OFF = 'border-slate-700/60 text-slate-400 hover:border-slate-500';

export default function ControlBar({ onOpenTopology }: Props) {
  const dataset = useAtlasStore(s => s.dataset);
  const showHulls = useAtlasStore(s => s.showHulls);
  const showGlobalHull = useAtlasStore(s => s.showGlobalHull);
  const showTable = useAtlasStore(s => s.showTable);
  const autoRotate = useAtlasStore(s => s.autoRotate);
  const setShowHulls = useAtlasStore(s => s.setShowHulls);
  const setShowGlobalHull = useAtlasStore(s => s.setShowGlobalHull);
  const setShowTable = useAtlasStore(s => s.setShowTable);
  const setAutoRotate = useAtlasStore(s => s.setAutoRotate);

  return (
    <div className="absolute top-0 left-0 right-0 z-20 px-8 py-6 flex justify-between items-start pointer-events-none">
      <div className="pointer-events-auto">
        <div className="flex items-center gap-3 mb-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          <span className="text-[10px] tracking-[0.32em] text-slate-400 uppercase font-mono">
            {dataset?.meta?.title ?? 'Embedding Atlas'}
          </span>
        </div>
        <h1 className="text-4xl font-light tracking-tight font-serif">
          The <span className="italic text-slate-300">Atlas</span>
        </h1>
        <div className="text-[11px] text-slate-500 mt-1.5 tracking-wider font-mono">
          {dataset?.meta?.projection ?? 'projection'} · {dataset?.points.length ?? 0} points · {dataset?.categories.length ?? 0} categories
        </div>
      </div>

      <div className="pointer-events-auto flex gap-2 flex-wrap justify-end max-w-[60%]">
        <button onClick={onOpenTopology} className={`${BTN_CLASS_BASE} ${BTN_CLASS_OFF}`} title="What does the shape of the data mean?">
          <Info size={11} className="inline mr-2 -mt-0.5" /> Read
        </button>
        <button onClick={() => setAutoRotate(!autoRotate)} className={`${BTN_CLASS_BASE} ${autoRotate ? BTN_CLASS_ON : BTN_CLASS_OFF}`}>
          <RotateCw size={11} className="inline mr-2 -mt-0.5" /> Orbit
        </button>
        <button onClick={() => setShowHulls(!showHulls)} className={`${BTN_CLASS_BASE} ${showHulls ? BTN_CLASS_ON : BTN_CLASS_OFF}`}>
          <Box size={11} className="inline mr-2 -mt-0.5" /> Hulls
        </button>
        <button onClick={() => setShowGlobalHull(!showGlobalHull)} className={`${BTN_CLASS_BASE} ${showGlobalHull ? BTN_CLASS_ON : BTN_CLASS_OFF}`}>
          <Globe size={11} className="inline mr-2 -mt-0.5" /> Manifold
        </button>
        <button onClick={() => setShowTable(!showTable)} className={`${BTN_CLASS_BASE} ${showTable ? BTN_CLASS_ON : BTN_CLASS_OFF}`}>
          <Table size={11} className="inline mr-2 -mt-0.5" /> Table
        </button>
      </div>
    </div>
  );
}
