/**
 * Zustand store for atlas application state.
 *
 * Three slices, each independent:
 *   - dataSlice: the loaded dataset and load status
 *   - filterSlice: dimension/event filtering state
 *   - uiSlice: view toggles, selection, table sort
 *
 * Why Zustand over Context:
 *   - No Provider boilerplate.
 *   - Selector subscriptions mean components only re-render when their
 *     specific slice changes (Context would force whole-tree re-renders).
 *   - Devtools support out of the box for debugging filter state.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AtlasDataset, AtlasPoint, ClusterShapeKind } from '../schema/types';
import type { RawBundle } from '../schema/raw';

/**
 * Table column key. Spans both the Points view (atlas point fields) and the
 * Raw view (`kind`, `when`, `source`), plus the synthetic `'user'` group key
 * used by both. Each table validates locally.
 */
export type TableSortKey =
  | keyof AtlasPoint
  | 'user'
  | 'when'
  | 'kind'
  | 'source';
export type TableView = 'points' | 'raw';

// ---------------- Data slice ----------------

interface DataSlice {
  dataset: AtlasDataset | null;
  rawBundle: RawBundle | null;
  loadError: string | null;
  setDataset: (d: AtlasDataset) => void;
  setRawBundle: (b: RawBundle | null) => void;
  setLoadError: (err: string | null) => void;
  /** Append new points to the current dataset. No-op when no dataset is loaded. */
  addPoints: (points: AtlasPoint[]) => void;
  /** Drop any points carrying `meta.injected === true` — used to reset the morph-toward-elite training. */
  removeInjectedPoints: () => void;
  /** Patch a single category's `shape` field (drives the rendered primitive in ClusterShapes). */
  setCategoryShape: (categoryId: string, shape: ClusterShapeKind) => void;
}

// ---------------- Filter slice ----------------

interface FilterSlice {
  enabledCategories: Set<string>;
  enabledLabels: Set<string>;
  toggleCategory: (id: string) => void;
  toggleLabel: (categoryId: string, labelName: string) => void;
  enableAll: (allCategories: string[], allLabels: string[]) => void;
  disableAll: () => void;
  resetFilters: (allCategories: string[], allLabels: string[]) => void;
}

// ---------------- UI slice ----------------

interface UISlice {
  showHulls: boolean;
  showGlobalHull: boolean;
  showTable: boolean;
  autoRotate: boolean;
  hoveredCategory: string | null;
  expandedCategory: string | null;
  selectedPoint: AtlasPoint | null;
  /**
   * Which category cluster the user clicked to inspect. Currently only the
   * 'user' cluster has a dedicated panel (MorphTargetPanel); future categories
   * could surface their own deep-dive overlays here.
   */
  inspectedCategory: string | null;
  tableSort: { key: TableSortKey; dir: 'asc' | 'desc' };
  tableView: TableView;
  setShowHulls: (v: boolean) => void;
  setShowGlobalHull: (v: boolean) => void;
  setShowTable: (v: boolean) => void;
  setAutoRotate: (v: boolean) => void;
  setHoveredCategory: (v: string | null) => void;
  setExpandedCategory: (v: string | null) => void;
  setSelectedPoint: (p: AtlasPoint | null) => void;
  setInspectedCategory: (v: string | null) => void;
  setTableSort: (s: { key: TableSortKey; dir: 'asc' | 'desc' }) => void;
  setTableView: (v: TableView) => void;
}

export type AtlasStore = DataSlice & FilterSlice & UISlice;

export const useAtlasStore = create<AtlasStore>()(
  devtools((set) => ({
    // Data
    dataset: null,
    rawBundle: null,
    loadError: null,
    setDataset: (d) => set({ dataset: d, loadError: null }, false, 'setDataset'),
    setRawBundle: (b) => set({ rawBundle: b }, false, 'setRawBundle'),
    setLoadError: (err) => set({ loadError: err }, false, 'setLoadError'),
    addPoints: (newPoints) => set((state) => {
      if (!state.dataset) return state;
      return {
        dataset: { ...state.dataset, points: [...state.dataset.points, ...newPoints] },
      };
    }, false, 'addPoints'),
    removeInjectedPoints: () => set((state) => {
      if (!state.dataset) return state;
      return {
        dataset: {
          ...state.dataset,
          points: state.dataset.points.filter(p => {
            const meta = p.meta as Record<string, unknown> | undefined;
            return meta?.injected !== true;
          }),
        },
      };
    }, false, 'removeInjectedPoints'),
    setCategoryShape: (id, shape) => set((state) => {
      if (!state.dataset) return state;
      return {
        dataset: {
          ...state.dataset,
          categories: state.dataset.categories.map(c => c.id === id ? { ...c, shape } : c),
        },
      };
    }, false, 'setCategoryShape'),

    // Filters
    enabledCategories: new Set<string>(),
    enabledLabels: new Set<string>(),
    toggleCategory: (id) => set((state) => {
      const n = new Set(state.enabledCategories);
      n.has(id) ? n.delete(id) : n.add(id);
      return { enabledCategories: n };
    }, false, 'toggleCategory'),
    toggleLabel: (categoryId, labelName) => set((state) => {
      const key = `${categoryId}::${labelName}`;
      const n = new Set(state.enabledLabels);
      n.has(key) ? n.delete(key) : n.add(key);
      return { enabledLabels: n };
    }, false, 'toggleLabel'),
    enableAll: (allCategories, allLabels) => set({
      enabledCategories: new Set(allCategories),
      enabledLabels: new Set(allLabels),
    }, false, 'enableAll'),
    disableAll: () => set({ enabledCategories: new Set() }, false, 'disableAll'),
    resetFilters: (allCategories, allLabels) => set({
      enabledCategories: new Set(allCategories),
      enabledLabels: new Set(allLabels),
    }, false, 'resetFilters'),

    // UI
    showHulls: false,
    showGlobalHull: false,
    showTable: false,
    autoRotate: false,
    hoveredCategory: null,
    expandedCategory: null,
    selectedPoint: null,
    inspectedCategory: null,
    tableSort: { key: 'user', dir: 'asc' },
    tableView: 'points',
    setShowHulls: (v) => set({ showHulls: v }, false, 'setShowHulls'),
    setShowGlobalHull: (v) => set({ showGlobalHull: v }, false, 'setShowGlobalHull'),
    setShowTable: (v) => set({ showTable: v }, false, 'setShowTable'),
    setAutoRotate: (v) => set({ autoRotate: v }, false, 'setAutoRotate'),
    setHoveredCategory: (v) => set({ hoveredCategory: v }, false, 'setHoveredCategory'),
    setExpandedCategory: (v) => set({ expandedCategory: v }, false, 'setExpandedCategory'),
    setSelectedPoint: (p) => set({ selectedPoint: p }, false, 'setSelectedPoint'),
    setInspectedCategory: (v) => set({ inspectedCategory: v }, false, 'setInspectedCategory'),
    setTableSort: (s) => set({ tableSort: s }, false, 'setTableSort'),
    setTableView: (v) => set({ tableView: v }, false, 'setTableView'),
  })),
);
