import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useAtlasStore } from '../store';

export default function EventCard() {
  const dataset = useAtlasStore(s => s.dataset);
  const selectedPoint = useAtlasStore(s => s.selectedPoint);
  const showTable = useAtlasStore(s => s.showTable);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);

  const category = useMemo(() => {
    if (!dataset || !selectedPoint) return null;
    return dataset.categories.find(c => c.id === selectedPoint.category) ?? null;
  }, [dataset, selectedPoint]);

  if (!selectedPoint || showTable || !category) return null;

  return (
    <div
      className="absolute top-28 left-8 z-20 w-[320px] border pointer-events-auto"
      style={{
        background: 'var(--panel-bg-soft)',
        borderColor: `${category.color}30`,
        boxShadow: `0 0 60px ${category.color}20, inset 0 0 0 1px rgba(255,255,255,0.03)`,
      }}
    >
      <div className="px-5 pt-5 pb-3 border-b border-slate-700/30">
        <div className="flex items-start justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: category.color, boxShadow: `0 0 12px ${category.color}` }} />
            <span className="text-[10px] uppercase tracking-[0.28em] font-mono" style={{ color: category.color }}>
              {category.label}
            </span>
          </div>
          <button onClick={() => setSelectedPoint(null)} className="text-slate-500 hover:text-slate-200 text-sm leading-none">×</button>
        </div>
        <div className="text-2xl font-light leading-tight font-serif">{selectedPoint.label ?? `Point #${selectedPoint.id}`}</div>
      </div>
      <div className="px-5 py-4 space-y-2.5 text-[11px] font-mono">
        {selectedPoint.value != null && (
          <div className="flex justify-between">
            <span className="text-slate-500 uppercase tracking-wider">Value</span>
            <span className="text-slate-200 tabular-nums">{selectedPoint.value}</span>
          </div>
        )}
        {selectedPoint.timestamp != null && (
          <div className="flex justify-between">
            <span className="text-slate-500 uppercase tracking-wider">Timestamp</span>
            <span className="text-slate-200 tabular-nums">
              {new Date(selectedPoint.timestamp).toLocaleString()}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500 uppercase tracking-wider">Coords</span>
          <span className="text-slate-200 tabular-nums">
            {selectedPoint.x.toFixed(2)}, {selectedPoint.y.toFixed(2)}, {selectedPoint.z.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 uppercase tracking-wider">ID</span>
          <span className="text-slate-200 tabular-nums">#{String(selectedPoint.id).padStart(4, '0')}</span>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-700/30 flex items-center gap-2 text-[10px] text-slate-500 font-mono">
        <Sparkles size={10} />
        <span>Click 'Table' for sortable view</span>
      </div>
    </div>
  );
}
