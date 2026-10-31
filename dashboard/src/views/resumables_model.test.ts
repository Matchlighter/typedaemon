import type { ResumableRow, ScriptRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { applyResumablesDelta, groupResumables, limitLabel, runsLabel } from './resumables_model';

const res = (key: string, over: Partial<ResumableRow> = {}): ResumableRow =>
    ({ key, status: 'running', type: 'resumable', owner: 'a', method: 'm', params: [], startedAt: 1, restarts: 0, ...over });
const scr = (key: string, over: Partial<ScriptRow> = {}): ScriptRow =>
    ({ key, mode: 'single', limit: 1, running: 0, queued: 0, runs: [], ...over });

describe('applyResumablesDelta', () => {
    it('applies each list on its own and leaves absent lists alone', () => {
        const cur = { resumables: [res('1'), res('2')], scripts: [scr('s')] };
        expect(applyResumablesDelta(cur, { resumables: { upsert: [res('2', { status: 'suspended' }), res('3')], remove: ['1'] } })).toEqual({
            resumables: [res('2', { status: 'suspended' }), res('3')], scripts: [scr('s')],
        });
        expect(applyResumablesDelta(cur, { scripts: { upsert: [scr('s', { running: 1 })] } }).scripts).toEqual([scr('s', { running: 1 })]);
    });
});

describe('groupResumables', () => {
    it('groups by status in the order running, suspended, failed, dropping empty groups; oldest first', () => {
        const groups = groupResumables([
            res('1', { status: 'failed', startedAt: 1 }), res('2', { startedAt: 9 }), res('3', { startedAt: 4 }),
        ]);
        expect(groups.map(g => [g.status, g.rows.map(r => r.key)])).toEqual([['running', ['3', '2']], ['failed', ['1']]]);
    });
});

describe('limitLabel / runsLabel', () => {
    it('shows running against the limit, with no limit as infinity', () => {
        expect(limitLabel(scr('s', { running: 2, limit: 5 }))).toBe('2 / 5');
        expect(limitLabel(scr('s', { running: 0, limit: null }))).toBe('0 / ∞');
    });
    it('formats a run call', () => {
        expect(runsLabel('evening', ['dusk', 3])).toBe('evening("dusk", 3)');
    });
});
