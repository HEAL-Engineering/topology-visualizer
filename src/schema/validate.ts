/**
 * Runtime validation for atlas datasets.
 *
 * The Zod schemas here mirror the TypeScript types in ./types.ts but execute
 * at runtime, which is what we need when accepting user-uploaded files. Zod
 * also produces helpful error messages out of the box ("Expected number,
 * received string at points[47].x") which we surface directly to the user.
 *
 * Use validateDataset() rather than calling AtlasDatasetSchema.parse() directly
 * — it adds cross-field checks (orphan category references, duplicate ids)
 * that Zod can't express alone.
 */
import { z } from 'zod';
import type {
  AtlasCategory,
  AtlasDataset,
  AtlasMeta,
  AtlasPoint,
} from './types';

export const AtlasPointSchema = z.object({
  id: z.union([z.string(), z.number()]),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  category: z.string().min(1, 'category cannot be empty'),
  label: z.string().optional(),
  value: z.number().finite().optional(),
  unit: z.string().optional(),
  timestamp: z.number().int().nonnegative().optional(),
  endTimestamp: z.number().int().nonnegative().optional(),
  source: z.string().min(1).optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  meta: z.record(z.unknown()).optional(),
}).refine(
  p => p.endTimestamp === undefined || p.timestamp === undefined || p.endTimestamp >= p.timestamp,
  { message: 'endTimestamp must be >= timestamp' },
) satisfies z.ZodType<AtlasPoint>;

export const ClusterShapeKindSchema = z.enum([
  'ellipsoid', 'torus', 'octahedron', 'dodecahedron', 'sphere', 'icosahedron',
]);

export const AtlasCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1).regex(
    /^(#[0-9a-fA-F]{3,8}|rgb|rgba|hsl|hsla|[a-zA-Z]+)/,
    'color must be a valid CSS color (hex, rgb, hsl, or named)',
  ),
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  shape: ClusterShapeKindSchema.optional(),
}) satisfies z.ZodType<AtlasCategory>;

export const AtlasMetaSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  projection: z.string().optional(),
  seed: z.number().optional(),
  generatedAt: z.number().optional(),
  sources: z.array(z.string().min(1)).optional(),
  metric: z.string().optional(),
}) satisfies z.ZodType<AtlasMeta>;

export const AtlasDatasetSchema = z.object({
  points: z.array(AtlasPointSchema).min(1, 'dataset must contain at least one point'),
  categories: z.array(AtlasCategorySchema).min(1, 'dataset must define at least one category'),
  meta: AtlasMetaSchema.optional(),
}) satisfies z.ZodType<AtlasDataset>;

/**
 * Full dataset validation, including cross-field integrity checks.
 *
 * Throws a `ValidationError` with a list of all problems found. Catching code
 * should prefer this over try/catch'ing on the underlying ZodError because
 * the cross-field issues (orphan categories, dangling mapper edges) are not
 * expressible in pure Zod.
 */
export function validateDataset(data: unknown): AtlasDataset {
  const parsed = AtlasDatasetSchema.parse(data);

  const categoryIds = new Set(parsed.categories.map(c => c.id));
  const issues: string[] = [];

  const orphanPoints = parsed.points.filter(p => !categoryIds.has(p.category));
  if (orphanPoints.length > 0) {
    const sample = orphanPoints.slice(0, 3).map(p => `#${p.id}→${p.category}`).join(', ');
    issues.push(
      `${orphanPoints.length} points reference undefined categories (e.g. ${sample}). ` +
      `Make sure every point's "category" matches a "categories[].id".`,
    );
  }

  // Duplicate id detection — IDs must be unique for the table & selection
  // logic to work correctly.
  const seenIds = new Set<string | number>();
  const duplicates = new Set<string | number>();
  for (const p of parsed.points) {
    if (seenIds.has(p.id)) duplicates.add(p.id);
    seenIds.add(p.id);
  }
  if (duplicates.size > 0) {
    const sample = [...duplicates].slice(0, 3).join(', ');
    issues.push(`${duplicates.size} duplicate point ids found (e.g. ${sample}). IDs must be unique.`);
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return parsed;
}

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Dataset validation failed:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ValidationError';
  }
}
