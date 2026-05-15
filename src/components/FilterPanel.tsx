import { useMemo } from 'react';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';

export default function FilterPanel() {
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const enabledLabels = useAtlasStore(s => s.enabledLabels);
  const expandedCategory = useAtlasStore(s => s.expandedCategory);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const toggleCategory = useAtlasStore(s => s.toggleCategory);
  const toggleLabel = useAtlasStore(s => s.toggleLabel);
  const enableAll = useAtlasStore(s => s.enableAll);
  const disableAll = useAtlasStore(s => s.disableAll);
  const setExpandedCategory = useAtlasStore(s => s.setExpandedCategory);
  const setHoveredCategory = useAtlasStore(s => s.setHoveredCategory);

  const { stats } = useDerivedState();

  // Per-category set of unique label values (from the data itself, not assumed).
  const labelsByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!dataset) return map;
    for (const p of dataset.points) {
      if (!p.label) continue;
      const existing = map.get(p.category) ?? [];
      if (!existing.includes(p.label)) existing.push(p.label);
      map.set(p.category, existing);
    }
    return map;
  }, [dataset]);

  if (!dataset) return null;

  const handleEnableAll = () => {
    const allCats = dataset.categories.map(c => c.id);
    const allLabels: string[] = [];
    labelsByCategory.forEach((labels, cat) => labels.forEach(l => allLabels.push(`${cat}::${l}`)));
    enableAll(allCats, allLabels);
  };

  return (
    <div className="pointer-events-auto atlas-scroll" style={{ width: 340, maxHeight: '50vh', overflowY: 'auto' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] tracking-[0.32em] text-slate-500 uppercase font-mono">
          Filters · <span className="text-slate-400">{stats.totalVisible}</span>
          <span className="text-slate-700">/{dataset.points.length}</span>
        </div>
        <div className="flex gap-1.5 text-[9px] tracking-[0.2em] uppercase items-center font-mono">
          <button onClick={handleEnableAll} className="text-slate-500 hover:text-slate-200 transition-colors">All</button>
          <span className="text-slate-700">·</span>
          <button onClick={disableAll} className="text-slate-500 hover:text-slate-200 transition-colors">None</button>
        </div>
      </div>

      <div className="space-y-0.5">
        {dataset.categories.map(cat => {
          const enabled = enabledCategories.has(cat.id);
          const isExpanded = expandedCategory === cat.id;
          const visibleCount = stats.visible[cat.id] ?? 0;
          const totalCount = stats.total[cat.id] ?? 0;
          const dimmed = hoveredCategory && hoveredCategory !== cat.id;
          const labels = labelsByCategory.get(cat.id) ?? [];
          const enabledLabelCount = labels.filter(l => enabledLabels.has(`${cat.id}::${l}`)).length;
          const hasPartialLabelFilter = labels.length > 0 && enabledLabelCount < labels.length;

          return (
            <div key={cat.id}>
              <div
                onMouseEnter={() => setHoveredCategory(cat.id)}
                onMouseLeave={() => setHoveredCategory(null)}
                className={`flex items-center gap-2.5 py-1 transition-opacity ${dimmed ? 'opacity-30' : 'opacity-100'}`}
              >
                <button onClick={() => toggleCategory(cat.id)} className="flex items-center gap-2.5 flex-1 text-left group">
                  <div
                    className="w-2 h-2 rounded-full transition-all flex-shrink-0"
                    style={{
                      background: enabled ? cat.color : 'transparent',
                      border: enabled ? 'none' : `1px solid ${cat.color}90`,
                      boxShadow: enabled ? `0 0 10px ${cat.color}` : 'none',
                    }}
                  />
                  <span
                    className={`text-xs font-light transition-colors ${enabled ? 'text-slate-200' : 'text-slate-600'}`}
                    style={enabled ? {} : { textDecoration: 'line-through', textDecorationColor: '#475569' }}
                  >
                    {cat.label}
                  </span>
                </button>
                <span className="text-[10px] text-slate-600 tabular-nums font-mono">
                  {visibleCount}<span className="text-slate-700">/{totalCount}</span>
                </span>
                {labels.length > 0 && (
                  <button
                    onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                    className={`text-[10px] w-5 h-5 flex items-center justify-center transition-colors font-mono ${hasPartialLabelFilter ? 'text-amber-400/80' : 'text-slate-600 hover:text-slate-300'}`}
                  >
                    {isExpanded ? '−' : '+'}
                  </button>
                )}
              </div>
              {isExpanded && (
                <div className="ml-5 mt-1 mb-2 flex flex-wrap gap-1">
                  {labels.map(lbl => {
                    const evEnabled = enabledLabels.has(`${cat.id}::${lbl}`);
                    return (
                      <button
                        key={lbl}
                        onClick={() => toggleLabel(cat.id, lbl)}
                        className="px-2 py-0.5 text-[9px] tracking-wide border transition-all font-mono"
                        style={{
                          borderColor: evEnabled ? `${cat.color}60` : '#334155',
                          background: evEnabled ? `${cat.color}18` : 'transparent',
                          color: evEnabled ? cat.color : '#64748b',
                        }}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
