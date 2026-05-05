/**
 * CSV adapter — converts CSV input into a canonical AtlasDataset.
 *
 * CSVs typically lack a categories block, so this adapter auto-generates
 * categories from unique values in the category column, assigning colors
 * from a default palette. If you want full control over category display
 * names or colors, generate the categories block separately and skip
 * autoCategorize.
 *
 * Usage:
 *   const dataset = csvToDataset(csvText, {
 *     autoCategorize: true,
 *     columnMap: { category: 'dimension', x: 'umap_x', y: 'umap_y', z: 'umap_z' },
 *   });
 */
import Papa from 'papaparse';
import type { AtlasCategory, AtlasDataset, AtlasPoint } from '../types';
import { validateDataset } from '../validate';

export interface CSVAdapterOptions {
  /**
   * Map from CSV column name → AtlasPoint field name. If omitted, columns
   * are expected to already be named: id, x, y, z, category, label, value,
   * timestamp.
   */
  columnMap?: Partial<Record<keyof AtlasPoint, string>>;
  /**
   * If true, auto-generate categories from unique values in the category
   * column, using the palette below. If false, you must supply categories
   * separately and merge them in.
   */
  autoCategorize?: boolean;
  /** Override the default color palette for auto-generated categories */
  palette?: string[];
  /** Skip validation (useful while iterating). Default: false. */
  skipValidation?: boolean;
}

const DEFAULT_PALETTE = [
  '#ff6b6b', '#ff9ec4', '#ffc857', '#4ecdc4',
  '#b794f4', '#a3e635', '#34d399', '#60a5fa',
  '#f97316', '#ec4899', '#14b8a6', '#8b5cf6',
  '#facc15', '#22d3ee', '#f472b6', '#fb923c',
];

export function csvToDataset(csvText: string, options: CSVAdapterOptions = {}): AtlasDataset {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      `CSV parse failed: ${parsed.errors.map(e => `${e.message} at row ${e.row}`).join('; ')}`,
    );
  }

  const map = options.columnMap ?? {};
  const colName = (field: keyof AtlasPoint): string => map[field] ?? field;

  const points: AtlasPoint[] = parsed.data.map((row, i) => {
    const id = row[colName('id')] ?? i;
    const point: AtlasPoint = {
      id: id as string | number,
      x: Number(row[colName('x')]),
      y: Number(row[colName('y')]),
      z: Number(row[colName('z')]),
      category: String(row[colName('category')] ?? ''),
    };
    const labelVal = row[colName('label')];
    if (labelVal != null) point.label = String(labelVal);
    const valueVal = row[colName('value')];
    if (valueVal != null && !Number.isNaN(Number(valueVal))) point.value = Number(valueVal);
    const tsVal = row[colName('timestamp')];
    if (tsVal != null && !Number.isNaN(Number(tsVal))) point.timestamp = Number(tsVal);
    return point;
  });

  let categories: AtlasCategory[];
  if (options.autoCategorize !== false) {
    const uniqueCategories = [...new Set(points.map(p => p.category))].filter(c => c !== '');
    const palette = options.palette ?? DEFAULT_PALETTE;
    categories = uniqueCategories.map((id, i) => ({
      id,
      label: id,
      color: palette[i % palette.length] ?? '#888888',
    }));
  } else {
    throw new Error(
      'CSV adapter requires autoCategorize: true OR an external categories source',
    );
  }

  const dataset: AtlasDataset = { points, categories };
  return options.skipValidation ? dataset : validateDataset(dataset);
}
