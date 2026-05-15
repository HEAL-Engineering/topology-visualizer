/**
 * Color ramps for the metric lens.
 *
 * The previous default was a "viridis-inspired" rainbow (blue → cyan →
 * green → yellow → orange → red). Rainbow ramps suffer from a perceptual
 * non-uniformity around the cyan / light-blue band — adjacent values look
 * the same color, and the user can't tell low-mid from low-low. We replace
 * it with three sequential perceptually-uniform ramps from matplotlib's
 * canon (plasma, viridis, magma) and let the user pick.
 *
 * Why three options and not one:
 *   - Plasma (purple → magenta → orange → yellow) has no blue region at
 *     all, so the original "light-blue confusion" disappears outright.
 *     This is the new default because it solves the reported problem.
 *   - True viridis still gets a teal stop, but the stops are spaced by
 *     perceived lightness rather than hue — adjacent values feel evenly
 *     separated. Familiar to anyone who's read a scientific plot.
 *   - Magma is the highest-contrast option for dark mode but its dark
 *     end nearly disappears on a dark background. Useful when the user
 *     wants the *high* values to pop and is OK losing the low end.
 *
 * Stop values are matplotlib's per-colormap 6-point samples, taken at
 * t ∈ {0, 0.2, 0.4, 0.6, 0.8, 1.0}. Both PointCloud (per-vertex sampler)
 * and MetricLens (CSS legend gradient) read from the same source here so
 * the legend is the literal key to the colors on screen.
 */

export type RampId = 'plasma' | 'viridis' | 'magma';

export interface RampInfo {
  id: RampId;
  label: string;
  description: string;
  /** Per-stop RGB in [0,1], same order as `hex`. Consumed by `sampleRamp`. */
  stops: Array<[number, [number, number, number]]>;
  /** Hex equivalents in the same order — fed to `linear-gradient(...)`. */
  hex: string[];
}

export const RAMP_IDS: readonly RampId[] = ['plasma', 'viridis', 'magma'] as const;

/**
 * Sample a ramp at normalized t ∈ [0,1]. Writes into `out` to keep this
 * allocation-free (called per-point inside a useEffect that touches every
 * dataset vertex on metric switch).
 */
export function sampleRamp(
  stops: RampInfo['stops'],
  t: number,
  out: [number, number, number],
): void {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]!;
    const [b, cb] = stops[i + 1]!;
    if (c <= b) {
      const u = (c - a) / (b - a);
      out[0] = ca[0] + (cb[0] - ca[0]) * u;
      out[1] = ca[1] + (cb[1] - ca[1]) * u;
      out[2] = ca[2] + (cb[2] - ca[2]) * u;
      return;
    }
  }
  const last = stops[stops.length - 1]![1];
  out[0] = last[0]; out[1] = last[1]; out[2] = last[2];
}

export const RAMPS: Record<RampId, RampInfo> = {
  plasma: {
    id: 'plasma',
    label: 'Plasma',
    description: 'Purple → magenta → orange → yellow. No blue zone.',
    stops: [
      [0.0, [0.051, 0.031, 0.529]],  // #0d0887
      [0.2, [0.329, 0.008, 0.639]],  // #5402a3
      [0.4, [0.545, 0.039, 0.647]],  // #8b0aa5
      [0.6, [0.800, 0.278, 0.471]],  // #cc4778
      [0.8, [0.957, 0.533, 0.286]],  // #f48849
      [1.0, [0.941, 0.976, 0.129]],  // #f0f921
    ],
    hex: ['#0d0887', '#5402a3', '#8b0aa5', '#cc4778', '#f48849', '#f0f921'],
  },
  viridis: {
    id: 'viridis',
    label: 'Viridis',
    description: 'Dark purple → teal → green → yellow. Perceptually uniform.',
    stops: [
      [0.0, [0.267, 0.004, 0.329]],  // #440154
      [0.2, [0.255, 0.267, 0.529]],  // #414487
      [0.4, [0.165, 0.471, 0.557]],  // #2a788e
      [0.6, [0.133, 0.659, 0.518]],  // #22a884
      [0.8, [0.478, 0.820, 0.318]],  // #7ad151
      [1.0, [0.992, 0.906, 0.145]],  // #fde725
    ],
    hex: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  },
  magma: {
    id: 'magma',
    label: 'Magma',
    description: 'Black → purple → red → orange → pale yellow.',
    stops: [
      [0.0, [0.000, 0.000, 0.016]],  // #000004
      [0.2, [0.231, 0.059, 0.439]],  // #3b0f70
      [0.4, [0.549, 0.161, 0.506]],  // #8c2981
      [0.6, [0.871, 0.286, 0.408]],  // #de4968
      [0.8, [0.996, 0.624, 0.427]],  // #fe9f6d
      [1.0, [0.988, 0.992, 0.749]],  // #fcfdbf
    ],
    hex: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  },
};

export const DEFAULT_RAMP_ID: RampId = 'plasma';
