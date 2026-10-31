import type { ScheduleRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { inRegistrationOrder } from './keyed_rows';
import { applySchedulesDelta } from './schedules_model';

const row = (key: string, over: Partial<ScheduleRow> = {}): ScheduleRow => ({ key, expression: 'x', kind: 'cron', method: 'm', ...over });

describe('schedules model', () => {
    it('folds upserts and removals into the snapshot', () => {
        const next = applySchedulesDelta({ rows: [row('1'), row('2')] }, { upsert: [row('2', { lastResult: 'ok' }), row('3')], remove: ['1'] });
        expect(next.rows).toEqual([row('2', { lastResult: 'ok' }), row('3')]);
    });

    it('orders by registration (numeric key) so rows do not jump when they fire', () => {
        expect(inRegistrationOrder([row('10'), row('2'), row('1')]).map(r => r.key)).toEqual(['1', '2', '10']);
    });
});
