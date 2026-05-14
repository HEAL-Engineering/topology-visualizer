/**
 * User-facing labels for the cluster shape primitives.
 *
 * The internal `ClusterShapeKind` ids are geometry-textbook names
 * (`ellipsoid`, `octahedron`, etc.) — accurate for the renderer and
 * the schema, but too jargon-heavy for the inspect panel and the
 * progress UI where users land cold. This map gives each kind a
 * one-word everyday equivalent.
 *
 * Mapping rationale:
 *   ellipsoid    → "Oval"      (smooth, stretched — like an egg/oval)
 *   torus        → "Ring"      (the donut hole IS the defining feature)
 *   octahedron   → "Diamond"   (8 triangle faces; the gemstone is exactly this)
 *   dodecahedron → "Crystal"   (12 pentagonal faces; reads as faceted gem)
 *   sphere       → "Ball"      (perfectly round, no faces)
 *   icosahedron  → "Bead"      (small faceted near-sphere; "user marker" semantic)
 *
 * Use `shapeLabel(kind)` in user-facing text instead of casing on the id
 * directly — keeps copy edits localized to this file.
 */
import type { ClusterShapeKind } from '../schema/types';

export const SHAPE_LABELS: Record<ClusterShapeKind, string> = {
  ellipsoid:    'Oval',
  torus:        'Ring',
  octahedron:   'Diamond',
  dodecahedron: 'Crystal',
  sphere:       'Ball',
  icosahedron:  'Bead',
};

export function shapeLabel(kind: ClusterShapeKind | undefined | null): string {
  if (!kind) return SHAPE_LABELS.ellipsoid;
  return SHAPE_LABELS[kind] ?? SHAPE_LABELS.ellipsoid;
}
