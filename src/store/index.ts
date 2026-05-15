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
import type { PhantomTrajectory } from '../lib/phantom-trajectory';
import { type RampId, DEFAULT_RAMP_ID } from '../data/color-ramps';

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
/**
 * App-wide color theme. Controls the 3D scene background, axes, grid, fog,
 * and the page-level wrapper. Floating UI panels keep their glass aesthetic
 * in both modes (they read as overlay cards either way).
 */
export type Theme = 'dark' | 'light';

// ---------------- Data slice ----------------

interface DataSlice {
  dataset: AtlasDataset | null;
  /**
   * Monotonically increasing counter that only bumps when an entirely new
   * dataset is set via `setDataset` (i.e. a fresh load). Point-mutating
   * actions like `addPoints` / `removeInjectedPoints` deliberately leave
   * this alone. Consumed by `CameraFit` so the camera refits on a real
   * dataset swap but stays put when the user logs training behaviors.
   */
  datasetEpoch: number;
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
  /**
   * Cache of projected "could-be" topologies keyed by
   * `${userCategoryId}::${eliteTargetId}` (e.g. `user::elite_male`). Pre-
   * populated in the background by `usePhantomPrecompute` whenever a
   * dataset loads, then read from `PhantomSection` and the renderer
   * without recomputing. Storing plural here (rather than a single
   * `phantomTrajectory`) means switching elite targets is instant — the
   * other projection is already sitting in the cache.
   */
  phantomCache: Record<string, PhantomTrajectory>;
  /** Mirror of in-flight projection keys → true. Drives the spinner UI. */
  phantomLoading: Record<string, boolean>;
  /** Cache key the renderer is currently showing. `null` = nothing chosen. */
  activePhantomKey: string | null;
  /** UI toggle for the 3D-scene phantom render. Independent from existence. */
  showPhantom: boolean;
  setPhantomCacheEntry: (key: string, trajectory: PhantomTrajectory) => void;
  setPhantomLoading: (key: string, loading: boolean) => void;
  setActivePhantomKey: (key: string | null) => void;
  setShowPhantom: (v: boolean) => void;
  clearPhantomCache: () => void;
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
  /**
   * Which sub-cluster within `inspectedCategory` is currently focused. A
   * category that splits into multiple spatial lobes (see splitIntoSubClusters)
   * emits one shape per lobe; the InspectPanel paginates between them via
   * this index. Always 0 for single-lobe categories. Resets to 0 whenever
   * inspectedCategory changes.
   */
  inspectedSubIndex: number;
  /**
   * Which biomarker metric (key into meta.biomarkers) the user has selected
   * as a lens. When set, PointCloud recolors points by the metric's value
   * (heatmap) and fades points lacking the field. `null` = default category
   * coloring. Single-active by design — multi-lens overlays would garble.
   */
  activeMetric: string | null;
  /**
   * Color ramp used by the metric lens. Decoupled from `activeMetric` so the
   * user can switch ramps with a lens already on and see the change live,
   * or pick a preferred ramp before turning a lens on.
   */
  activeRamp: RampId;
  theme: Theme;
  tableSort: { key: TableSortKey; dir: 'asc' | 'desc' };
  tableView: TableView;
  setShowHulls: (v: boolean) => void;
  setShowTable: (v: boolean) => void;
  setAutoRotate: (v: boolean) => void;
  setHoveredCategory: (v: string | null) => void;
  setExpandedCategory: (v: string | null) => void;
  setSelectedPoint: (p: AtlasPoint | null) => void;
  setInspectedCategory: (v: string | null) => void;
  setInspectedSubIndex: (i: number) => void;
  setActiveMetric: (v: string | null) => void;
  setActiveRamp: (v: RampId) => void;
  setTheme: (v: Theme) => void;
  setTableSort: (s: { key: TableSortKey; dir: 'asc' | 'desc' }) => void;
  setTableView: (v: TableView) => void;
}

export type AtlasStore = DataSlice & FilterSlice & UISlice;

export const useAtlasStore = create<AtlasStore>()(
  devtools((set) => ({
    // Data
    dataset: null,
    datasetEpoch: 0,
    rawBundle: null,
    loadError: null,
    setDataset: (d) => set((state) => ({
      dataset: d,
      loadError: null,
      datasetEpoch: state.datasetEpoch + 1,
    }), false, 'setDataset'),
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
    phantomCache: {},
    phantomLoading: {},
    activePhantomKey: null,
    showPhantom: false,
    setPhantomCacheEntry: (key, trajectory) => set((state) => ({
      phantomCache: { ...state.phantomCache, [key]: trajectory },
    }), false, 'setPhantomCacheEntry'),
    setPhantomLoading: (key, loading) => set((state) => {
      // Drop the key entirely when loading is false — keeps the loading
      // map small and lets `phantomLoading[key]` read as falsy without
      // a defined-but-false entry lingering.
      const next = { ...state.phantomLoading };
      if (loading) next[key] = true; else delete next[key];
      return { phantomLoading: next };
    }, false, 'setPhantomLoading'),
    setActivePhantomKey: (key) => set({ activePhantomKey: key }, false, 'setActivePhantomKey'),
    setShowPhantom: (v) => set({ showPhantom: v }, false, 'setShowPhantom'),
    clearPhantomCache: () => set({
      phantomCache: {},
      phantomLoading: {},
      activePhantomKey: null,
      showPhantom: false,
    }, false, 'clearPhantomCache'),

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
    showHulls: true,
    showTable: false,
    autoRotate: false,
    hoveredCategory: null,
    expandedCategory: null,
    selectedPoint: null,
    inspectedCategory: null,
    inspectedSubIndex: 0,
    activeMetric: null,
    activeRamp: DEFAULT_RAMP_ID,
    theme: 'dark',
    tableSort: { key: 'user', dir: 'asc' },
    tableView: 'points',
    setShowHulls: (v) => set({ showHulls: v }, false, 'setShowHulls'),
    setShowTable: (v) => set({ showTable: v }, false, 'setShowTable'),
    setAutoRotate: (v) => set({ autoRotate: v }, false, 'setAutoRotate'),
    setHoveredCategory: (v) => set({ hoveredCategory: v }, false, 'setHoveredCategory'),
    setExpandedCategory: (v) => set({ expandedCategory: v }, false, 'setExpandedCategory'),
    setSelectedPoint: (p) => set({ selectedPoint: p }, false, 'setSelectedPoint'),
    // Inspecting a (different) category always resets the sub-pagination so
    // a freshly-opened panel starts on lobe 0. Tab clicks call setInspected-
    // SubIndex directly to switch within the same category.
    setInspectedCategory: (v) => set({ inspectedCategory: v, inspectedSubIndex: 0 }, false, 'setInspectedCategory'),
    setInspectedSubIndex: (i) => set({ inspectedSubIndex: i }, false, 'setInspectedSubIndex'),
    setActiveMetric: (v) => set({ activeMetric: v }, false, 'setActiveMetric'),
    setActiveRamp: (v) => set({ activeRamp: v }, false, 'setActiveRamp'),
    setTheme: (v) => set({ theme: v }, false, 'setTheme'),
    setTableSort: (s) => set({ tableSort: s }, false, 'setTableSort'),
    setTableView: (v) => set({ tableView: v }, false, 'setTableView'),
  })),
);
