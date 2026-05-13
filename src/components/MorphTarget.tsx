import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, Check, Utensils, Dumbbell, Moon, HeartPulse, RotateCcw, Sparkles } from 'lucide-react';
import { useAtlasStore } from '../store';
import type { AtlasPoint, ClusterShapeKind } from '../schema/types';

/**
 * Fitness signature per cohort. Numbers are synthetic prototypes that match
 * the wellness-cohort positions encoded in the atlas geometry — they exist
 * to make the morph-toward-elite gap concrete and actionable for the user.
 *
 * Units:
 *   caloriesIntake          kcal / day
 *   caloriesBurnedTotal     kcal / week (training + NEAT)
 *   caloriesBurnedAvg       kcal / workout session
 *   workoutHrs              hours / week
 *   vo2max                  ml O2 / kg / min  (higher = better)
 *   hrv                     ms RMSSD  (higher = better recovery)
 */
type FitnessSignature = {
  caloriesIntake: number;
  caloriesBurnedTotal: number;
  caloriesBurnedAvg: number;
  workoutHrs: number;
  vo2max: number;
  hrv: number;
};

const SIGNATURES: Record<string, FitnessSignature> = {
  avg_male:     { caloriesIntake: 2400, caloriesBurnedTotal: 2500, caloriesBurnedAvg: 350, workoutHrs: 3.0, vo2max: 38, hrv: 35 },
  avg_female:   { caloriesIntake: 1900, caloriesBurnedTotal: 2100, caloriesBurnedAvg: 300, workoutHrs: 2.5, vo2max: 34, hrv: 40 },
  elite_male:   { caloriesIntake: 3200, caloriesBurnedTotal: 6000, caloriesBurnedAvg: 750, workoutHrs: 10,  vo2max: 62, hrv: 75 },
  elite_female: { caloriesIntake: 2800, caloriesBurnedTotal: 5200, caloriesBurnedAvg: 680, workoutHrs: 9,   vo2max: 56, hrv: 70 },
  user:         { caloriesIntake: 2500, caloriesBurnedTotal: 3200, caloriesBurnedAvg: 450, workoutHrs: 5,   vo2max: 44, hrv: 50 },
};

type MetricKey = keyof FitnessSignature;

type MetricDef = {
  key: MetricKey;
  label: string;
  unit: string;
  /** Direction the elite cohort exceeds baseline; controls "increase" vs "decrease" verb. */
  higherIsBetter: boolean;
  /** Considered "matched" when |gap| / target is within this fraction. */
  tolerance: number;
  /** Workout / dietary suggestions when the metric needs to move toward the target. */
  suggestionsUp: { workout: string[]; diet: string[] };
  suggestionsDown: { workout: string[]; diet: string[] };
};

const METRICS: MetricDef[] = [
  {
    key: 'caloriesIntake',
    label: 'Calories intake',
    unit: 'kcal/day',
    higherIsBetter: true,
    tolerance: 0.08,
    suggestionsUp: {
      diet: [
        'Lift intake by ~300–500 kcal/day, biased toward protein (1.6–2.0 g/kg) and complex carbs around training.',
        'Add one structured meal pre-workout (carb + protein) and one post (carb + protein within 60 min).',
        'Include calorie-dense whole foods: oats, rice, nut butters, olive oil, salmon, eggs.',
      ],
      workout: [
        'Higher intake only pays off with the volume to absorb it — pair with increased training hours.',
      ],
    },
    suggestionsDown: {
      diet: [
        'Trim ~250 kcal/day from refined carbs and alcohol first; preserve protein.',
        'Front-load calories earlier in the day; reduce late-evening intake.',
      ],
      workout: [
        'Keep training volume constant while cutting to avoid recomposition rebound.',
      ],
    },
  },
  {
    key: 'caloriesBurnedTotal',
    label: 'Calories burned (weekly total)',
    unit: 'kcal/wk',
    higherIsBetter: true,
    tolerance: 0.1,
    suggestionsUp: {
      workout: [
        'Add 2–3 zone-2 cardio sessions (45–60 min) per week — the highest-leverage way to raise weekly burn.',
        'Increase NEAT: target 10–12k steps/day, take walking meetings, stand-desk 2+ hrs/day.',
        'Add one weekly long session (90 min hike, ride, or swim).',
      ],
      diet: [
        'Fuel the added volume: +200–400 kcal on training days, mostly carbs.',
      ],
    },
    suggestionsDown: {
      workout: ['Reduce session count, not session quality. Keep intensity, cut junk volume.'],
      diet: [],
    },
  },
  {
    key: 'caloriesBurnedAvg',
    label: 'Calories burned (per workout)',
    unit: 'kcal/session',
    higherIsBetter: true,
    tolerance: 0.1,
    suggestionsUp: {
      workout: [
        'Add a 10–15 min finisher: EMOM, AMRAP, sled push, or assault-bike intervals.',
        'Lengthen strength sessions to 60–75 min and use compound lifts (squat, deadlift, press, row).',
        'Insert one heavy conditioning block per session: 4×4 min @ ~90% effort with 3 min rest.',
      ],
      diet: [
        'Pre-workout carbs (40–60 g) 60 min out to sustain higher per-session output.',
      ],
    },
    suggestionsDown: {
      workout: ['Shorter, more frequent sessions if recovery is limiting per-session output.'],
      diet: [],
    },
  },
  {
    key: 'workoutHrs',
    label: 'Workout hours',
    unit: 'hr/wk',
    higherIsBetter: true,
    tolerance: 0.1,
    suggestionsUp: {
      workout: [
        'Block 5 fixed weekly sessions in calendar (treat as non-negotiable meetings).',
        'Add 2 short AM micro-sessions (20–30 min: mobility + zone-2) on rest days.',
        'Hybrid week template: 3× strength, 2× zone-2 cardio, 1× intervals, 1× active recovery.',
      ],
      diet: [
        'Distribute protein into 4–5 feedings/day to support recovery from the higher volume.',
      ],
    },
    suggestionsDown: {
      workout: ['Cut accessory volume before main lifts; preserve compound work.'],
      diet: [],
    },
  },
  {
    key: 'vo2max',
    label: 'VO₂ max',
    unit: 'ml/kg/min',
    higherIsBetter: true,
    tolerance: 0.08,
    suggestionsUp: {
      workout: [
        '4×4 min at 90–95% HRmax with 3 min jog recovery, 2× per week — the most evidence-backed VO₂max protocol.',
        'Layer in 80/20 polarized training: 80% easy zone-2, 20% high-intensity intervals.',
        'Long, slow distance once a week (60–90 min at conversational pace) to expand stroke volume.',
        'Cross-train mode (run + row + bike) to drive central adaptation without overloading joints.',
      ],
      diet: [
        'Iron-rich foods (red meat, lentils, spinach) to support oxygen transport; consider ferritin test if plateauing.',
        'Beetroot juice 2–3 hr pre-test/race — meta-analyses show modest VO₂ efficiency gains.',
      ],
    },
    suggestionsDown: {
      workout: ['No reason to lower VO₂max intentionally.'],
      diet: [],
    },
  },
  {
    key: 'hrv',
    label: 'HRV (RMSSD)',
    unit: 'ms',
    higherIsBetter: true,
    tolerance: 0.1,
    suggestionsUp: {
      workout: [
        'Periodize: alternate hard weeks with deload weeks every 4th week — chronic overload suppresses HRV.',
        'Daily 10 min slow-breathing protocol (6 breaths/min, 5s in / 5s out) — directly raises parasympathetic tone.',
        'Zone-2 aerobic base work raises HRV more reliably than high-intensity training.',
      ],
      diet: [
        'Sleep 7–9 hrs with consistent wake time; HRV is more sensitive to sleep than to any food.',
        'Eliminate alcohol within 3 hrs of bed — single biggest controllable HRV suppressor.',
        'Magnesium glycinate (300–400 mg evenings), omega-3 (EPA+DHA 2 g/day).',
        'Stop eating 3 hrs before bed; late meals depress overnight HRV.',
      ],
    },
    suggestionsDown: {
      workout: ['Higher HRV reflects better recovery — no protocol lowers it intentionally.'],
      diet: [],
    },
  },
];

type TargetKey = 'elite_male' | 'elite_female';

function formatGap(metric: MetricDef, current: number, target: number): string {
  const delta = target - current;
  const abs = Math.abs(delta);
  if (abs < 1) return abs.toFixed(2);
  if (metric.unit.includes('kcal')) return Math.round(abs).toLocaleString();
  return abs % 1 === 0 ? abs.toString() : abs.toFixed(1);
}

function statusFor(metric: MetricDef, current: number, target: number) {
  const gap = target - current;
  const withinTolerance = Math.abs(gap) / target <= metric.tolerance;
  if (withinTolerance) return { kind: 'match' as const, gap };
  return { kind: gap > 0 ? ('increase' as const) : ('decrease' as const), gap };
}

export default function MorphTarget() {
  const dataset = useAtlasStore(s => s.dataset);
  const [target, setTarget] = useState<TargetKey>('elite_male');

  const targetCat = dataset?.categories.find(c => c.id === target);
  const userCat = dataset?.categories.find(c => c.id === 'user');
  const userSig = SIGNATURES.user;
  const targetSig = SIGNATURES[target];

  if (!targetCat || !userCat || !userSig || !targetSig) return null;

  const accent = targetCat.color;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] tracking-[0.32em] text-slate-500 uppercase font-mono">
            Morph target
          </div>
          <div className="text-[13px] text-slate-200 mt-1">
            How <span className="font-medium">your icosahedron</span> moves toward an elite shape.
          </div>
        </div>
        <div className="flex gap-1.5">
          {(['elite_male', 'elite_female'] as const).map(t => {
            const cat = dataset?.categories.find(c => c.id === t);
            if (!cat) return null;
            const on = target === t;
            return (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className="px-3 py-1.5 text-[10px] tracking-[0.22em] uppercase border transition-all font-mono"
                style={{
                  borderColor: on ? `${cat.color}88` : 'rgba(71, 85, 105, 0.5)',
                  color: on ? cat.color : '#94a3b8',
                  background: on ? `${cat.color}10` : 'transparent',
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="px-4 py-3 border text-[12px] text-slate-400 leading-relaxed"
        style={{
          borderColor: `${accent}30`,
          background: `${accent}06`,
        }}
      >
        <span className="text-slate-200">Geometric goal:</span> grow your icosahedron's vertices
        outward along the dimensions where {targetCat.label} dominates, until your shape
        approximates a {target === 'elite_male' ? 'sharper octahedron' : 'symmetric dodecahedron'}.
        Each metric below is one vertex pulling in that direction.
      </div>

      <TrainSection target={target} accent={accent} targetShape={targetCat.shape ?? 'octahedron'} />

      <div className="space-y-2">
        {METRICS.map(metric => {
          const current = userSig[metric.key];
          const goal = targetSig[metric.key];
          const status = statusFor(metric, current, goal);

          return (
            <MetricCard
              key={metric.key}
              metric={metric}
              current={current}
              goal={goal}
              status={status}
              accent={accent}
            />
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({
  metric,
  current,
  goal,
  status,
  accent,
}: {
  metric: MetricDef;
  current: number;
  goal: number;
  status: { kind: 'match' | 'increase' | 'decrease'; gap: number };
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const matched = status.kind === 'match';
  const direction = status.kind;
  const suggestions =
    direction === 'increase' ? metric.suggestionsUp :
    direction === 'decrease' ? metric.suggestionsDown :
    null;

  const dirColor = matched ? '#34d399' : direction === 'increase' ? accent : '#f59e0b';
  const Icon = matched ? Check : direction === 'increase' ? ArrowUp : ArrowDown;
  const verb = matched ? 'on target' : direction === 'increase' ? 'increase' : 'decrease';

  return (
    <div
      className="border transition-colors"
      style={{
        borderColor: open ? `${dirColor}55` : 'rgba(71, 85, 105, 0.3)',
        background: open ? `${dirColor}08` : 'var(--inset-bg)',
      }}
    >
      <button
        onClick={() => !matched && setOpen(o => !o)}
        disabled={matched}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ cursor: matched ? 'default' : 'pointer' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `${dirColor}18`, color: dirColor }}
          >
            <Icon size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-slate-100 text-[13px] font-medium truncate">
              {metric.label}
            </div>
            <div className="text-slate-500 text-[11px] font-mono mt-0.5">
              {current.toLocaleString()} {metric.unit}
              <span className="text-slate-600"> → </span>
              <span style={{ color: dirColor }}>{goal.toLocaleString()} {metric.unit}</span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div
            className="text-[10px] tracking-[0.22em] uppercase font-mono"
            style={{ color: dirColor }}
          >
            {verb}
          </div>
          {!matched && (
            <div className="text-[11px] text-slate-400 font-mono">
              {direction === 'increase' ? '+' : '−'}{formatGap(metric, current, goal)} {metric.unit}
            </div>
          )}
        </div>
      </button>

      {open && suggestions && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: `${dirColor}20` }}>
          {suggestions.workout.length > 0 && (
            <SuggestionGroup
              icon={<Dumbbell size={11} />}
              title="Training"
              color={dirColor}
              items={suggestions.workout}
            />
          )}
          {suggestions.diet.length > 0 && (
            <SuggestionGroup
              icon={<Utensils size={11} />}
              title="Diet"
              color={dirColor}
              items={suggestions.diet}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Behaviors the user can "log" to drag their user-cluster topology toward
 * the selected elite cohort. Each click appends N synthetic user points
 * sampled near a random elite cluster member, blended with the current
 * user centroid (so the cluster mass migrates progressively, not in one
 * teleport). Once the cumulative injected count crosses a threshold, the
 * `user` category's `shape` is morphed:
 *
 *   < 6   → icosahedron        (the default user marker)
 *   6–14  → dodecahedron       (intermediate "structuring")
 *   15+   → target's shape     (elite_male = octahedron, elite_female = dodecahedron)
 *
 * The shape swap is what gives the visible topology morph — adding points
 * alone only shifts centroid + spread; swapping the primitive is what
 * makes the cluster crystallize into the elite geometry.
 */
type BehaviorKind = 'training' | 'meal' | 'recovery' | 'sleep';

const BEHAVIOR_DEFS: Array<{
  kind: BehaviorKind;
  label: string;
  icon: React.ElementType;
  blurb: string;
}> = [
  { kind: 'training', label: 'Log training', icon: Dumbbell, blurb: '4×4 VO₂ block' },
  { kind: 'meal',     label: 'Log clean meal', icon: Utensils, blurb: '2g/kg protein + carbs' },
  { kind: 'recovery', label: 'Log recovery',  icon: HeartPulse, blurb: 'zone-2 + breathwork' },
  { kind: 'sleep',    label: 'Log sleep win', icon: Moon, blurb: '8h, 0 alcohol' },
];

const POINTS_PER_CLICK = 3;
/** Saturate progress visualization at this many injected points (≈ 10 clicks). */
const PROGRESS_CEIL = 30;
const SHAPE_THRESHOLD_MID = 6;
const SHAPE_THRESHOLD_FULL = 15;

function TrainSection({
  target,
  accent,
  targetShape,
}: { target: TargetKey; accent: string; targetShape: ClusterShapeKind }) {
  const dataset = useAtlasStore(s => s.dataset);
  const addPoints = useAtlasStore(s => s.addPoints);
  const removeInjectedPoints = useAtlasStore(s => s.removeInjectedPoints);
  const setCategoryShape = useAtlasStore(s => s.setCategoryShape);

  // Recompute centroids + counts whenever the dataset mutates. Cheap O(n)
  // scans — datasets here are bounded by a few thousand points.
  const { userCentroid, elitePoints, injected } = useMemo(() => {
    if (!dataset) return { userCentroid: null as [number, number, number] | null, elitePoints: [] as AtlasPoint[], injected: 0 };
    let ux = 0, uy = 0, uz = 0, un = 0;
    const elite: AtlasPoint[] = [];
    let inj = 0;
    for (const p of dataset.points) {
      if (p.category === 'user') {
        ux += p.x; uy += p.y; uz += p.z; un++;
        const meta = p.meta as Record<string, unknown> | undefined;
        if (meta?.injected === true) inj++;
      } else if (p.category === target) {
        elite.push(p);
      }
    }
    return {
      userCentroid: un > 0 ? ([ux / un, uy / un, uz / un] as [number, number, number]) : null,
      elitePoints: elite,
      injected: inj,
    };
  }, [dataset, target]);

  const canTrain = !!userCentroid && elitePoints.length > 0;

  const inject = (kind: BehaviorKind) => {
    if (!canTrain || !userCentroid) return;

    // Progressive bias — early clicks land partway between user and elite
    // (looks like effort, not teleport); later clicks land closer to the
    // elite cluster (the user is "becoming elite"). Mapped from injected
    // count rather than click count so it's robust to batch logging.
    const progress = Math.min(injected / PROGRESS_CEIL, 1);
    const baseT = 0.45 + 0.4 * progress; // 0.45 → 0.85
    const jitterAmp = 0.45;

    const newPoints: AtlasPoint[] = [];
    for (let i = 0; i < POINTS_PER_CLICK; i++) {
      const pick = elitePoints[Math.floor(Math.random() * elitePoints.length)]!;
      const t = baseT + (Math.random() - 0.5) * 0.1;
      const j = () => (Math.random() - 0.5) * jitterAmp;
      newPoints.push({
        id: `injected-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        x: userCentroid[0] * (1 - t) + pick.x * t + j(),
        y: userCentroid[1] * (1 - t) + pick.y * t + j(),
        z: userCentroid[2] * (1 - t) + pick.z * t + j(),
        category: 'user',
        label: BEHAVIOR_DEFS.find(b => b.kind === kind)?.label ?? 'Logged behavior',
        timestamp: Date.now() + i,
        source: 'logged',
        meta: { injected: true, kind, towards: target },
      });
    }
    addPoints(newPoints);

    const totalAfter = injected + POINTS_PER_CLICK;
    const nextShape: ClusterShapeKind =
      totalAfter >= SHAPE_THRESHOLD_FULL ? targetShape :
      totalAfter >= SHAPE_THRESHOLD_MID ? 'dodecahedron' :
      'icosahedron';
    setCategoryShape('user', nextShape);
  };

  const reset = () => {
    removeInjectedPoints();
    setCategoryShape('user', 'icosahedron');
  };

  const progressPct = Math.min(injected / PROGRESS_CEIL, 1) * 100;
  const stage =
    injected >= SHAPE_THRESHOLD_FULL ? 'elite' :
    injected >= SHAPE_THRESHOLD_MID ? 'structuring' :
    'starting';

  return (
    <div
      className="border px-4 py-4 space-y-3"
      style={{
        borderColor: `${accent}30`,
        background: `${accent}05`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={12} style={{ color: accent }} />
          <div className="text-[10px] tracking-[0.28em] uppercase font-mono text-slate-300">
            Train toward shape
          </div>
        </div>
        <button
          onClick={reset}
          disabled={injected === 0}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] tracking-[0.18em] uppercase font-mono border transition-all"
          style={{
            borderColor: injected === 0 ? 'rgba(71,85,105,0.25)' : 'rgba(148,163,184,0.4)',
            color: injected === 0 ? '#475569' : '#cbd5e1',
            cursor: injected === 0 ? 'not-allowed' : 'pointer',
          }}
          title="Remove all logged points"
        >
          <RotateCcw size={10} /> Reset
        </button>
      </div>

      <p className="text-[12px] text-slate-400 leading-relaxed">
        Each click logs a real-world behavior as a new point near {target === 'elite_male' ? 'the elite-male' : 'the elite-female'} cluster.
        Your cluster's centroid migrates and the icosahedron crystallizes into the target's shape as you stack reps.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {BEHAVIOR_DEFS.map(({ kind, label, icon: Icon, blurb }) => (
          <button
            key={kind}
            onClick={() => inject(kind)}
            disabled={!canTrain}
            className="px-3 py-2.5 text-left border transition-all group"
            style={{
              borderColor: canTrain ? `${accent}55` : 'rgba(71,85,105,0.3)',
              background: canTrain ? `${accent}10` : 'transparent',
              cursor: canTrain ? 'pointer' : 'not-allowed',
            }}
            title={canTrain ? `+${POINTS_PER_CLICK} points toward ${target}` : 'Load dataset to enable'}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <Icon size={12} />
              <span className="text-[11px] tracking-[0.18em] uppercase font-mono" style={{ color: accent }}>
                {label}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">{blurb}</div>
          </button>
        ))}
      </div>

      <div className="space-y-1.5 pt-1">
        <div className="flex items-baseline justify-between text-[10px] tracking-[0.22em] uppercase font-mono">
          <span className="text-slate-500">Progress</span>
          <span style={{ color: accent }}>
            {injected} pts · {stage}
          </span>
        </div>
        <div className="h-1 bg-slate-800/80 overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: accent,
              boxShadow: `0 0 8px ${accent}`,
            }}
          />
        </div>
        <div className="flex justify-between text-[9px] tracking-[0.18em] uppercase font-mono text-slate-600">
          <span>icosahedron</span>
          <span style={injected >= SHAPE_THRESHOLD_MID ? { color: accent } : undefined}>dodecahedron</span>
          <span style={injected >= SHAPE_THRESHOLD_FULL ? { color: accent } : undefined}>
            {targetShape}
          </span>
        </div>
      </div>
    </div>
  );
}

function SuggestionGroup({
  icon, title, color, items,
}: { icon: React.ReactNode; title: string; color: string; items: string[] }) {
  return (
    <div className="pt-3">
      <div
        className="text-[10px] tracking-[0.28em] uppercase font-mono mb-1.5 flex items-center gap-1.5"
        style={{ color }}
      >
        {icon} {title}
      </div>
      <ul className="space-y-1.5 text-[12px] text-slate-300">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0" style={{ color: `${color}99` }}>·</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
