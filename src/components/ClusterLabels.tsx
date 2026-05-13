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
import { useMemo } from 'react';
import { useAtlasStore } from '../store';
import { useDerivedState } from '../lib/use-derived';

const LABEL_OFFSET_FACTOR = 1.1;

/**
 * Darken a hex color toward black for use as text on a light background.
 * The atlas category palette is tuned for additive blending on near-black
 * — `#60a5fa` etc. — so pixels-against-white contrast is poor without
 * this. Multiplying RGB toward 0 by `ratio` keeps the hue stable while
 * boosting luminance contrast against light glass.
 */
export function darken(hex: string, ratio = 0.55): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return hex;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgb(${Math.round(r * ratio)}, ${Math.round(g * ratio)}, ${Math.round(b * ratio)})`;
}

export default function ClusterLabels() {
  const { clusterShapes } = useDerivedState();
  const dataset = useAtlasStore(s => s.dataset);
  const enabledCategories = useAtlasStore(s => s.enabledCategories);
  const hoveredCategory = useAtlasStore(s => s.hoveredCategory);
  const activeMetric = useAtlasStore(s => s.activeMetric);
  const theme = useAtlasStore(s => s.theme);
  const setHoveredCategory = useAtlasStore(s => s.setHoveredCategory);
  const setInspectedCategory = useAtlasStore(s => s.setInspectedCategory);
  const isLight = theme === 'light';

  // Per-category point counts — surfaced on the user badge so the "Your data"
  // label can show e.g. "YOUR DATA · 83 days". Cheap O(n) scan.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    if (!dataset) return m;
    for (const p of dataset.points) m[p.category] = (m[p.category] ?? 0) + 1;
    return m;
  }, [dataset]);

  // Lens mode strips all per-category styling. Labels carry the category's
  // color and would re-introduce the noise we're trying to suppress. Must
  // sit AFTER all hooks so the hook order is stable across renders.
  if (activeMetric) return null;

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
        const isUser = category.id === 'user';
        const count = counts[category.id] ?? 0;
        const primary = isUser ? 'Your data' : category.label;
        const subtitle = isUser ? `${count} day${count === 1 ? '' : 's'}` : null;
        // Light-mode tuning: white-ish glass bg with a darkened version of
        // the category color (the saturated palette is tuned for additive
        // blending on near-black; on white it reads washed out).
        const labelColor = isLight ? darken(category.color, 0.7) : category.color;
        const labelBg = isLight
          ? (isUser ? 'rgba(255, 252, 246, 0.95)' : 'rgba(255, 252, 246, 0.85)')
          : (isUser ? 'rgba(4, 7, 17, 0.92)' : 'rgba(4, 7, 17, 0.78)');
        const haloColor = isLight ? category.color : category.color;
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
              title={isUser
                ? `Click to inspect your topology (${count} entries)`
                : `Click to inspect ${category.label} topology`}
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: isUser ? 11 : 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                padding: isUser ? '6px 12px' : '4px 9px',
                background: labelBg,
                color: labelColor,
                border: `${isUser ? 2 : 1}px solid ${category.color}${isUser ? 'aa' : '66'}`,
                borderRadius: 2,
                boxShadow: isLight
                  ? (isUser
                      ? `0 4px 14px ${haloColor}44, 0 0 0 1px ${haloColor}33 inset`
                      : `0 2px 8px ${haloColor}22`)
                  : (isUser
                      ? `0 0 22px ${category.color}66, 0 0 6px ${category.color}cc inset`
                      : `0 0 14px ${category.color}33`),
                opacity: dim ? 0.25 : (isUser ? 1 : 0.95),
                userSelect: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {isUser && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: category.color,
                    boxShadow: `0 0 8px ${category.color}`,
                  }}
                />
              )}
              <span>{primary}</span>
              {subtitle && (
                <span style={{ opacity: 0.65, fontSize: 9, letterSpacing: '0.18em' }}>
                  · {subtitle}
                </span>
              )}
              <span style={{ marginLeft: 2, opacity: 0.55, fontSize: 9 }}>›</span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
