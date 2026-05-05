import { useEffect, useMemo } from 'react';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';
import type { AtlasPoint } from '../schema/types';

type SortKey = 'id' | 'category' | 'label' | 'value' | 'timestamp';

export default function TablePanel() {
  const dataset = useAtlasStore(s => s.dataset);
  const showTable = useAtlasStore(s => s.showTable);
  const tableSort = useAtlasStore(s => s.tableSort);
  const selectedPoint = useAtlasStore(s => s.selectedPoint);
  const setShowTable = useAtlasStore(s => s.setShowTable);
  const setTableSort = useAtlasStore(s => s.setTableSort);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);

  const { filteredWithIdx } = useDerivedState();
  const categoryById = useMemo(() => {
    const m = new Map<string, { color: string; label: string }>();
    dataset?.categories.forEach(c => m.set(c.id, { color: c.color, label: c.label }));
    return m;
  }, [dataset]);

  const sortedRows = useMemo(() => {
    const arr = [...filteredWithIdx];
    const { key, dir } = tableSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[key as keyof AtlasPoint];
      const bv = b[key as keyof AtlasPoint];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return arr;
  }, [filteredWithIdx, tableSort]);

  useEffect(() => {
    if (!selectedPoint || !showTable) return;
    const el = document.getElementById(`atlas-row-${selectedPoint.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedPoint, showTable]);

  if (!showTable || !dataset) return null;

  const handleSort = (key: SortKey) => {
    setTableSort({
      key: key as keyof AtlasPoint,
      dir: tableSort.key === key && tableSort.dir === 'asc' ? 'desc' : 'asc',
    });
  };
  const sortIcon = (key: SortKey) => {
    if (tableSort.key !== key) return <span className="text-slate-700 ml-1">↕</span>;
    return <span className="text-emerald-400 ml-1">{tableSort.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div
      className="absolute top-0 right-0 z-30 h-full pointer-events-auto flex flex-col border-l border-slate-800/60"
      style={{ width: 540, background: 'rgba(6, 9, 21, 0.86)', backdropFilter: 'blur(24px)' }}
    >
      <div className="px-6 py-5 border-b border-slate-800/60 flex items-start justify-between flex-shrink-0">
        <div>
          <div className="text-[10px] tracking-[0.32em] text-slate-500 uppercase mb-1.5 font-mono">Tabular</div>
          <div className="text-3xl font-light leading-none font-serif">
            {sortedRows.length}
            <span className="text-slate-600 italic text-xl ml-2">/ {dataset.points.length}</span>
          </div>
          <div className="text-[10px] text-slate-600 mt-2 tracking-wide font-mono">
            Sorted by {String(tableSort.key)} · {tableSort.dir}
          </div>
        </div>
        <button onClick={() => setShowTable(false)} className="text-slate-500 hover:text-slate-200 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
      </div>

      <div className="flex-1 overflow-y-auto atlas-scroll">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10" style={{ background: 'rgba(6, 9, 21, 0.96)' }}>
            <tr className="border-b border-slate-800/80">
              <th onClick={() => handleSort('category')} className="px-5 py-3 text-left text-slate-500 uppercase tracking-[0.18em] text-[9px] cursor-pointer hover:text-slate-300 select-none font-mono">
                Category {sortIcon('category')}
              </th>
              <th onClick={() => handleSort('label')} className="px-3 py-3 text-left text-slate-500 uppercase tracking-[0.18em] text-[9px] cursor-pointer hover:text-slate-300 select-none font-mono">
                Label {sortIcon('label')}
              </th>
              <th onClick={() => handleSort('value')} className="px-3 py-3 text-right text-slate-500 uppercase tracking-[0.18em] text-[9px] cursor-pointer hover:text-slate-300 select-none font-mono">
                Value {sortIcon('value')}
              </th>
              <th onClick={() => handleSort('id')} className="px-5 py-3 text-right text-slate-500 uppercase tracking-[0.18em] text-[9px] cursor-pointer hover:text-slate-300 select-none font-mono">
                ID {sortIcon('id')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(p => {
              const meta = categoryById.get(p.category);
              const isSelected = selectedPoint?.id === p.id;
              return (
                <tr
                  key={String(p.id)}
                  id={`atlas-row-${p.id}`}
                  onClick={() => setSelectedPoint(p)}
                  className={`border-b border-slate-800/30 cursor-pointer transition-colors ${isSelected ? '' : 'hover:bg-slate-800/40'}`}
                  style={isSelected && meta ? { background: `${meta.color}14`, boxShadow: `inset 3px 0 0 ${meta.color}` } : {}}
                >
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta?.color, boxShadow: `0 0 8px ${meta?.color}` }} />
                      <span className="text-[11px] text-slate-400 font-mono">{meta?.label ?? p.category}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-200 font-serif" style={{ fontSize: 13 }}>{p.label ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-mono">{p.value ?? '—'}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600 tabular-nums font-mono">#{String(p.id).padStart(4, '0')}</td>
                </tr>
              );
            })}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-slate-500 text-xs font-mono">
                  No points match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
