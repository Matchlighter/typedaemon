import type { KeyedDelta, RowsSnapshot } from '@protocol';
import { applyKeyedDelta } from './keyed_rows';

/** Fold an `appSchedules` / `schedules` topic delta into the snapshot */
export const applySchedulesDelta = <R extends { key: string }>(cur: RowsSnapshot<R>, d: KeyedDelta<R>): RowsSnapshot<R> => ({ rows: applyKeyedDelta(cur.rows, d) });
