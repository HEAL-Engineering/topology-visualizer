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
import type { AtlasDataset, AtlasPoint } from '../schema/types';

// ---------------- Data slice ----------------

interface DataSlice {
  dataset: AtlasDataset | null;
  loadError: string | null;
  setDataset: (d: AtlasDataset) => void;
  setLoadError: (err: string | null) => void;
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
  showMapper: boolean;
  showHulls: boolean;
  showGlobalHull: boolean;
  showTable: boolean;
  autoRotate: boolean;
  hoveredCategory: string | null;
  expandedCategory: string | null;
  selectedPoint: AtlasPoint | null;
  tableSort: { key: keyof AtlasPoint; dir: 'asc' | 'desc' };
  setShowMapper: (v: boolean) => void;
  setShowHulls: (v: boolean) => void;
  setShowGlobalHull: (v: boolean) => void;
  setShowTable: (v: boolean) => void;
  setAutoRotate: (v: boolean) => void;
  setHoveredCategory: (v: string | null) => void;
  setExpandedCategory: (v: string | null) => void;
  setSelectedPoint: (p: AtlasPoint | null) => void;
  setTableSort: (s: { key: keyof AtlasPoint; dir: 'asc' | 'desc' }) => void;
}

export type AtlasStore = DataSlice & FilterSlice & UISlice;

export const useAtlasStore = create<AtlasStore>()(
  devtools((set) => ({
    // Data
    dataset: null,
    loadError: null,
    setDataset: (d) => set({ dataset: d, loadError: null }, false, 'setDataset'),
    setLoadError: (err) => set({ loadError: err }, false, 'setLoadError'),

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
    showMapper: true,
    showHulls: false,
    showGlobalHull: false,
    showTable: false,
    autoRotate: true,
    hoveredCategory: null,
    expandedCategory: null,
    selectedPoint: null,
    tableSort: { key: 'id', dir: 'asc' },
    setShowMapper: (v) => set({ showMapper: v }, false, 'setShowMapper'),
    setShowHulls: (v) => set({ showHulls: v }, false, 'setShowHulls'),
    setShowGlobalHull: (v) => set({ showGlobalHull: v }, false, 'setShowGlobalHull'),
    setShowTable: (v) => set({ showTable: v }, false, 'setShowTable'),
    setAutoRotate: (v) => set({ autoRotate: v }, false, 'setAutoRotate'),
    setHoveredCategory: (v) => set({ hoveredCategory: v }, false, 'setHoveredCategory'),
    setExpandedCategory: (v) => set({ expandedCategory: v }, false, 'setExpandedCategory'),
    setSelectedPoint: (p) => set({ selectedPoint: p }, false, 'setSelectedPoint'),
    setTableSort: (s) => set({ tableSort: s }, false, 'setTableSort'),
  })),
);
