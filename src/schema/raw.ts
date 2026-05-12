/**
 * Raw heal-api dedup record shapes (pre-featurization, pre-UMAP).
 *
 * Mirrors the JSON dump produced by heal-api's dedup_* tables and consumed
 * by `pipeline/heal_atlas` as input. The renderer shows these in the Raw
 * tab of the TablePanel — useful when the user wants to inspect the
 * underlying records rather than the projected embedding points.
 */

export interface RawHeartRate {
  user_id: number | string;
  source: string;
  min_bpm: number;
  max_bpm: number;
  avg_bpm: number;
  start_time: string;
  end_time: string;
}

export interface RawSleepSession {
  user_id: number | string;
  date: string;
  /** 1 = light, 2 = deep, 3 = rem, 4 = awake (heal-api convention). */
  stage_type: 1 | 2 | 3 | 4;
  duration_minutes: number;
  source: string;
}

export interface RawDailySteps {
  user_id: number | string;
  date: string;
  steps: number;
  source: string;
}

/**
 * Multi-user raw bundle. The on-disk format ships one user per file
 * (`{user_id, dedup_*}`); `loadRawBundle` normalizes into this shape so
 * the UI can iterate users uniformly.
 */
export interface RawBundle {
  /** Keyed by stringified user_id. */
  users: Record<string, RawUser>;
}

export interface RawUser {
  userId: string;
  heart_rates: RawHeartRate[];
  sleep_sessions: RawSleepSession[];
  daily_steps: RawDailySteps[];
}

export type RawRecordKind = 'heart_rate' | 'sleep' | 'steps';

/**
 * Flattened view: one row per raw record, type-tagged. Used to render
 * a single unified table across the three record kinds.
 */
export interface RawRow {
  userId: string;
  kind: RawRecordKind;
  source: string;
  /** ISO date/time of the record (start_time for HR, date for sleep/steps). */
  when: string;
  /** Numeric primary value: avg_bpm, duration_minutes, or steps. */
  value: number;
  unit: string;
  /** Free-form trailing detail string (HR range, sleep stage name, …). */
  details: string;
}

const STAGE_NAMES: Record<RawSleepSession['stage_type'], string> = {
  1: 'Light',
  2: 'Deep',
  3: 'REM',
  4: 'Awake',
};

/**
 * Parse the on-disk format. Accepts either:
 *   - single user: `{user_id, dedup_heart_rates, dedup_sleep_sessions, dedup_daily_steps}`
 *   - multi user:  `{users: [<single>, <single>, ...]}`
 */
export function parseRawBundle(text: string): RawBundle {
  const parsed = JSON.parse(text);
  const singles: SingleUserDump[] = Array.isArray(parsed?.users)
    ? parsed.users
    : [parsed];
  const users: Record<string, RawUser> = {};
  for (const dump of singles) {
    if (dump?.user_id == null) continue;
    const id = String(dump.user_id);
    users[id] = {
      userId: id,
      heart_rates: dump.dedup_heart_rates ?? [],
      sleep_sessions: dump.dedup_sleep_sessions ?? [],
      daily_steps: dump.dedup_daily_steps ?? [],
    };
  }
  return { users };
}

interface SingleUserDump {
  user_id: number | string;
  dedup_heart_rates?: RawHeartRate[];
  dedup_sleep_sessions?: RawSleepSession[];
  dedup_daily_steps?: RawDailySteps[];
}

export function flattenUser(user: RawUser): RawRow[] {
  const rows: RawRow[] = [];
  for (const hr of user.heart_rates) {
    rows.push({
      userId: user.userId,
      kind: 'heart_rate',
      source: hr.source,
      when: hr.start_time,
      value: hr.avg_bpm,
      unit: 'bpm',
      details: `${hr.min_bpm}–${hr.max_bpm} bpm · ${formatWindow(hr.start_time, hr.end_time)}`,
    });
  }
  for (const s of user.sleep_sessions) {
    rows.push({
      userId: user.userId,
      kind: 'sleep',
      source: s.source,
      when: s.date,
      value: s.duration_minutes,
      unit: 'min',
      details: `${STAGE_NAMES[s.stage_type] ?? `stage ${s.stage_type}`}`,
    });
  }
  for (const st of user.daily_steps) {
    rows.push({
      userId: user.userId,
      kind: 'steps',
      source: st.source,
      when: st.date,
      value: st.steps,
      unit: 'steps',
      details: '',
    });
  }
  return rows;
}

function formatWindow(start: string, end: string): string {
  const startTime = start.slice(11, 16);
  const endTime = end.slice(11, 16);
  return startTime && endTime ? `${startTime}–${endTime}` : '';
}
