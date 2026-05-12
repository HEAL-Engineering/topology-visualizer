/**
 * ClusterLabels — floating category badges at each cluster centroid.
 *
 * Solves the "which cluster is which" gap that color + shape alone can't
 * fully close. Each badge is a small DOM overlay (drei's `<Html>`) anchored
 * at the PCA centroid + an offset along the major principal axis, so the
 * label sits *above* the cluster rather than buried inside it.
 *
 * Behavior:
 *   - Hidden when the category is filter-disabled (parity with ClusterShapes).
 *   - Dimmed when the user is hovering a different category in the legend.
 *   - `occlude={false}`: labels always read on top of points/hulls.
 *   - `distanceFactor`: text grows/shrinks with camera distance so a single
 *     CSS font-size stays legible at any zoom.
 *
 * The badge is a thin, low-contrast pill on dark background — meant to
 * inform without competing visually with the 3D scene.
 */
import { Html } from '@react-three/drei';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';

const LABEL_OFFSET_FACTOR = 1.1;

export default function ClusterLabels() {
  const { clusterShapes } = useDerivedState();
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const setHoveredCategory = useAtlasStore(s => s.setHoveredCategory);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);

  return (
    <group>
      {clusterShapes.map(({ category, shape }) => {
        if (!enabledCategories.has(category.id)) return null;
        const [cx, cy, cz] = shape.centroid;
        // Offset upward along the world y-axis by the major half-axis so
        // labels stack above ellipsoids/crystals consistently regardless
        // of the cluster's principal-axis orientation.
        const lift = shape.halfAxes[0] * LABEL_OFFSET_FACTOR;
        const dim = hoveredCategory != null && hoveredCategory !== category.id;
        return (
          <Html
            key={category.id}
            position={[cx, cy + lift, cz]}
            center
            distanceFactor={12}
            occlude={false}
            style={{ pointerEvents: 'auto', transition: 'opacity 120ms ease' }}
            zIndexRange={[5, 0]}
          >
            <div
              onMouseEnter={() => setHoveredCategory(category.id)}
              onMouseLeave={() => setHoveredCategory(null)}
              onClick={() => setInspectedCategory(category.id)}
              title="Click to inspect this cluster's topology"
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                padding: '4px 9px',
                background: 'rgba(4, 7, 17, 0.78)',
                color: category.color,
                border: `1px solid ${category.color}66`,
                borderRadius: 2,
                boxShadow: `0 0 14px ${category.color}33`,
                opacity: dim ? 0.25 : 0.95,
                userSelect: 'none',
                cursor: 'pointer',
              }}
            >
              {category.label}
              <span style={{ marginLeft: 6, opacity: 0.55, fontSize: 9 }}>›</span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
