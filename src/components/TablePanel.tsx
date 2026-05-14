import { Fragment, useEffect, useMemo } from 'react';
import { useAtlasStore, type TableSortKey, type TableView } from '../store';
import { useDerivedState } from '../lib/use-derived';
import type { AtlasPoint } from '../schema/types';
import { flattenUser, type RawRow } from '../schema/raw';

const POINT_SORT_KEYS = ['user', 'category', 'label', 'value', 'id'] as const;
const RAW_SORT_KEYS = ['user', 'when', 'kind', 'value', 'source'] as const;

const KIND_COLORS: Record<RawRow['kind'], string> = {
  heart_rate: '#ff6b6b',
  sleep: '#7c3aed',
  steps: '#34d399',
};

const KIND_LABELS: Record<RawRow['kind'], string> = {
  heart_rate: 'Heart Rate',
  sleep: 'Sleep',
  steps: 'Steps',
};

export default function TablePanel() {
  const dataset = useAtlasStore(s => s.dataset);
  const rawBundle = useAtlasStore(s => s.rawBundle);
  const showTable = useAtlasStore(s => s.showTable);
  const tableSort = useAtlasStore(s => s.tableSort);
  const tableView = useAtlasStore(s => s.tableView);
  const selectedPoint = useAtlasStore(s => s.selectedPoint);
  const setShowTable = useAtlasStore(s => s.setShowTable);
  const setTableSort = useAtlasStore(s => s.setTableSort);
  const setTableView = useAtlasStore(s => s.setTableView);
  const setSelectedPoint = useAtlasStore(s => s.setSelectedPoint);

  const { filteredWithIdx } = useDerivedState();

  const categoryById = useMemo(() => {
    const m = new Map<string, { color: string; label: string }>();
    dataset?.categories.forEach(c => m.set(c.id, { color: c.color, label: c.label }));
    return m;
  }, [dataset]);

  // ---------- Points mode ----------
  const sortedPoints = useMemo(() => {
    const arr = [...filteredWithIdx];
    const { key, dir } = tableSort;
    const mult = dir === 'asc' ? 1 : -1;
    const userKey = (p: AtlasPoint) => String(p.userId ?? p.category);
    arr.sort((a, b) => {
      const av = key === 'user' ? userKey(a) : a[key as keyof AtlasPoint];
      const bv = key === 'user' ? userKey(b) : b[key as keyof AtlasPoint];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return arr;
  }, [filteredWithIdx, tableSort]);

  const pointUserCount = useMemo(() => {
    const s = new Set<string>();
    for (const p of filteredWithIdx) s.add(String(p.userId ?? p.category));
    return s.size;
  }, [filteredWithIdx]);

  // ---------- Raw mode ----------
  const rawRows = useMemo<RawRow[]>(() => {
    if (!rawBundle) return [];
    const rows: RawRow[] = [];
    for (const user of Object.values(rawBundle.users)) {
      rows.push(...flattenUser(user));
    }
    return rows;
  }, [rawBundle]);

  const sortedRaw = useMemo(() => {
    const arr = [...rawRows];
    const { key, dir } = tableSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = key === 'user' ? a.userId : a[key as keyof RawRow];
      const bv = key === 'user' ? b.userId : b[key as keyof RawRow];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return arr;
  }, [rawRows, tableSort]);

  const rawUserCount = rawBundle ? Object.keys(rawBundle.users).length : 0;

  useEffect(() => {
    if (!selectedPoint || !showTable || tableView !== 'points') return;
    const el = document.getElementById(`atlas-row-${selectedPoint.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedPoint, showTable, tableView]);

  if (!showTable || !dataset) return null;

  const handleSort = (key: TableSortKey) => {
    setTableSort({
      key,
      dir: tableSort.key === key && tableSort.dir === 'asc' ? 'desc' : 'asc',
    });
  };
  const sortIcon = (key: TableSortKey) => {
    if (tableSort.key !== key) return <span className="text-slate-700 ml-1">↕</span>;
    return <span className="text-emerald-400 ml-1">{tableSort.dir === 'asc' ? '↑' : '↓'}</span>;
  };
  const switchView = (v: TableView) => {
    if (v === tableView) return;
    setTableView(v);
    // Reset sort if the current key isn't valid for the new view.
    const validKeys: readonly string[] = v === 'points' ? POINT_SORT_KEYS : RAW_SORT_KEYS;
    if (!validKeys.includes(tableSort.key)) {
      setTableSort({ key: 'user', dir: 'asc' });
    }
  };

  return (
    <div
      className="absolute top-0 right-0 z-30 h-full pointer-events-auto flex flex-col border-l border-slate-800/60"
      style={{ width: 620, background: 'var(--table-bg)' }}
    >
      <div className="px-6 py-5 border-b border-slate-800/60 flex items-start justify-between flex-shrink-0">
        <div>
          <div className="text-[10px] tracking-[0.32em] text-slate-500 uppercase mb-1.5 font-mono">Tabular</div>
          <div className="text-3xl font-light leading-none font-serif">
            {tableView === 'points' ? sortedPoints.length : sortedRaw.length}
            <span className="text-slate-600 italic text-xl ml-2">
              {tableView === 'points'
                ? `/ ${dataset.points.length} · ${pointUserCount} user${pointUserCount === 1 ? '' : 's'}`
                : `raw record${sortedRaw.length === 1 ? '' : 's'} · ${rawUserCount} user${rawUserCount === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="text-[10px] text-slate-600 mt-2 tracking-wide font-mono">
            Sorted by {String(tableSort.key)} · {tableSort.dir}
          </div>
        </div>
        <button onClick={() => setShowTable(false)} className="text-slate-500 hover:text-slate-200 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
      </div>

      {/* View tabs */}
      <div className="flex border-b border-slate-800/60 flex-shrink-0">
        <TabButton active={tableView === 'points'} onClick={() => switchView('points')} label="Points" hint={`${dataset.points.length}`} />
        <TabButton active={tableView === 'raw'} onClick={() => switchView('raw')} label="Raw" hint={rawBundle ? `${rawRows.length}` : '—'} disabled={!rawBundle} />
      </div>

      <div className="flex-1 overflow-y-auto atlas-scroll">
        {tableView === 'points' ? (
          <PointsTable
            rows={sortedPoints}
            categoryById={categoryById}
            selectedPoint={selectedPoint}
            setSelectedPoint={setSelectedPoint}
            handleSort={handleSort}
            sortIcon={sortIcon}
            groupByUser={tableSort.key === 'user'}
          />
        ) : (
          <RawTable
            rows={sortedRaw}
            hasBundle={!!rawBundle}
            handleSort={handleSort}
            sortIcon={sortIcon}
            groupByUser={tableSort.key === 'user'}
            atlasPoints={dataset?.points ?? []}
            setSelectedPoint={setSelectedPoint}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, hint, disabled }: { active: boolean; onClick: () => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 px-5 py-3 text-[10px] tracking-[0.28em] uppercase font-mono border-b-2 transition-colors ${
        active
          ? 'text-emerald-300 border-emerald-400/70'
          : disabled
            ? 'text-slate-700 border-transparent cursor-not-allowed'
            : 'text-slate-500 border-transparent hover:text-slate-300'
      }`}
    >
      {label} <span className="text-slate-700 ml-1">{hint}</span>
    </button>
  );
}

// ---------------- Points table ----------------

interface PointsTableProps {
  rows: AtlasPoint[];
  categoryById: Map<string, { color: string; label: string }>;
  selectedPoint: AtlasPoint | null;
  setSelectedPoint: (p: AtlasPoint | null) => void;
  handleSort: (key: TableSortKey) => void;
  sortIcon: (key: TableSortKey) => JSX.Element;
  groupByUser: boolean;
}

function PointsTable({ rows, categoryById, selectedPoint, setSelectedPoint, handleSort, sortIcon, groupByUser }: PointsTableProps) {
  let lastUser: string | null = null;
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 z-10" style={{ background: 'var(--table-hdr-bg)' }}>
        <tr className="border-b border-slate-800/80">
          <Th onClick={() => handleSort('user')} icon={sortIcon('user')}>User</Th>
          <Th onClick={() => handleSort('category')} icon={sortIcon('category')}>Category</Th>
          <Th onClick={() => handleSort('label')} icon={sortIcon('label')}>Label</Th>
          <Th onClick={() => handleSort('value')} icon={sortIcon('value')} align="right">Value</Th>
          <Th onClick={() => handleSort('id')} icon={sortIcon('id')} align="right">ID</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(p => {
          const meta = categoryById.get(p.category);
          const isSelected = selectedPoint?.id === p.id;
          const userKey = String(p.userId ?? p.category);
          const userLabel = p.userId != null ? `User ${p.userId}` : (meta?.label ?? p.category);
          const showGroupHeader = groupByUser && userKey !== lastUser;
          lastUser = userKey;
          return (
            <Fragment key={String(p.id)}>
              {showGroupHeader && (
                <tr className="bg-slate-900/60">
                  <td colSpan={5} className="px-5 py-2 text-[9px] uppercase tracking-[0.32em] text-slate-400 font-mono border-y border-slate-800/40">
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: meta?.color, boxShadow: `0 0 6px ${meta?.color}` }} />
                    {userLabel}
                  </td>
                </tr>
              )}
              <tr
                id={`atlas-row-${p.id}`}
                onClick={() => setSelectedPoint(p)}
                className={`border-b border-slate-800/30 cursor-pointer transition-colors ${isSelected ? '' : 'hover:bg-slate-800/40'}`}
                style={isSelected && meta ? { background: `${meta.color}14`, boxShadow: `inset 3px 0 0 ${meta.color}` } : {}}
              >
                <td className="px-5 py-2.5 text-slate-400 font-mono text-[10px]">{userLabel}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta?.color, boxShadow: `0 0 8px ${meta?.color}` }} />
                    <span className="text-[11px] text-slate-400 font-mono">{meta?.label ?? p.category}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-200 font-serif" style={{ fontSize: 13 }}>{p.label ?? '—'}</td>
                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-mono">{p.value ?? '—'}</td>
                <td className="px-5 py-2.5 text-right text-slate-600 tabular-nums font-mono">#{String(p.id).padStart(4, '0')}</td>
              </tr>
            </Fragment>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="px-5 py-12 text-center text-slate-500 text-xs font-mono">
              No points match the current filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ---------------- Raw table ----------------

interface RawTableProps {
  rows: RawRow[];
  hasBundle: boolean;
  handleSort: (key: TableSortKey) => void;
  sortIcon: (key: TableSortKey) => JSX.Element;
  groupByUser: boolean;
  atlasPoints: AtlasPoint[];
  setSelectedPoint: (p: AtlasPoint | null) => void;
}

function RawTable({ rows, hasBundle, handleSort, sortIcon, groupByUser, atlasPoints, setSelectedPoint }: RawTableProps) {
  // Index atlas points by id once so the click-to-jump on the new
  // `Derived → atlas` column is O(1) per row.
  const atlasById = useMemo(() => {
    const m = new Map<string, AtlasPoint>();
    for (const p of atlasPoints) m.set(String(p.id), p);
    return m;
  }, [atlasPoints]);

  if (!hasBundle) {
    return (
      <div className="px-6 py-16 text-center text-slate-500 text-xs font-mono">
        No raw data bundle loaded.<br />
        <span className="text-slate-600 text-[10px]">Drop a heal-api dedup JSON into <code className="text-slate-400">public/raw.json</code>.</span>
      </div>
    );
  }
  let lastUser: string | null = null;
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 z-10" style={{ background: 'var(--table-hdr-bg)' }}>
        <tr className="border-b border-slate-800/80">
          <Th onClick={() => handleSort('user')} icon={sortIcon('user')}>User</Th>
          <Th onClick={() => handleSort('when')} icon={sortIcon('when')}>When</Th>
          <Th onClick={() => handleSort('kind')} icon={sortIcon('kind')}>Type</Th>
          <Th onClick={() => handleSort('value')} icon={sortIcon('value')} align="right">Value</Th>
          <Th onClick={() => handleSort('source')} icon={sortIcon('source')}>Source</Th>
          <Th>Details</Th>
          <Th>Derived → atlas</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const showGroupHeader = groupByUser && r.userId !== lastUser;
          lastUser = r.userId;
          return (
            <Fragment key={`raw-${i}`}>
              {showGroupHeader && (
                <tr className="bg-slate-900/60">
                  <td colSpan={7} className="px-5 py-2 text-[9px] uppercase tracking-[0.32em] text-slate-400 font-mono border-y border-slate-800/40">
                    User {r.userId}
                  </td>
                </tr>
              )}
              <tr className="border-b border-slate-800/30 hover:bg-slate-800/40 transition-colors">
                <td className="px-5 py-2.5 text-slate-400 font-mono text-[10px]">User {r.userId}</td>
                <td className="px-3 py-2.5 text-slate-300 font-mono text-[10px] tabular-nums">{formatWhen(r.when)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: KIND_COLORS[r.kind], boxShadow: `0 0 8px ${KIND_COLORS[r.kind]}` }} />
                    <span className="text-[11px] text-slate-400 font-mono">{KIND_LABELS[r.kind]}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-slate-200 tabular-nums font-mono">
                  {r.value} <span className="text-slate-600 text-[9px] ml-0.5">{r.unit}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-400 font-mono text-[10px]">{r.source}</td>
                <td className="px-3 py-2.5 text-slate-500 font-mono text-[10px]">{r.details || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[10px]">
                  {r.atlas_point_id ? (
                    (() => {
                      const target = atlasById.get(r.atlas_point_id);
                      return target ? (
                        <button
                          onClick={() => setSelectedPoint(target)}
                          className="text-emerald-400 hover:text-emerald-200 underline-offset-2 hover:underline transition-colors"
                          title="Jump to derived atlas point"
                        >
                          {r.atlas_point_id}
                        </button>
                      ) : (
                        <span className="text-slate-600" title="atlas_point_id has no matching atlas point">
                          {r.atlas_point_id}
                        </span>
                      );
                    })()
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
              </tr>
            </Fragment>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="px-5 py-12 text-center text-slate-500 text-xs font-mono">
              Bundle loaded but contains no records.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Th({ children, onClick, icon, align }: { children: React.ReactNode; onClick?: () => void; icon?: JSX.Element; align?: 'right' }) {
  const justify = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      onClick={onClick}
      className={`px-3 py-3 ${justify} text-slate-500 uppercase tracking-[0.18em] text-[9px] select-none font-mono ${onClick ? 'cursor-pointer hover:text-slate-300' : ''}`}
    >
      {children} {icon}
    </th>
  );
}

function formatWhen(when: string): string {
  // ISO-ish input. If it carries a time (T...), keep YYYY-MM-DD HH:MM; otherwise just the date.
  if (when.length >= 16 && when.includes('T')) return `${when.slice(0, 10)} ${when.slice(11, 16)}`;
  return when;
}
