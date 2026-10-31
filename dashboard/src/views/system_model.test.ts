import type { CrossCallRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { blockedOn, isStuck, sortCalls } from './system_model';

const call = (uuid: string, over: Partial<CrossCallRow> = {}): CrossCallRow =>
    ({ uuid, source: 'a', target: 'b', method: 'm', status: 'pending', targetState: 'started', ...over });

describe('isStuck', () => {
    it('is an unfinished (pending, started, returning) call whose target is dead or gone', () => {
        expect(isStuck(call('1', { targetState: 'dead' }))).toBe(true);
        expect(isStuck(call('1', { targetState: undefined }))).toBe(true);
    });
    it('is not a pending call waiting on a target that is coming up or running, but a started call on a live target is fine', () => {
        for (const s of ['started', 'starting', 'compiling', 'stopped'] as const) expect(isStuck(call('1', { targetState: s }))).toBe(false);
        for (const status of ['started', 'returning'] as const) expect(isStuck(call('1', { status, targetState: 'dead' }))).toBe(true);
    });
});

describe('sortCalls', () => {
    it('puts stuck calls first, then oldest first; calls without a date last', () => {
        const rows = [call('new', { since: 20 }), call('nodate'), call('old', { since: 10 }), call('stuck', { targetState: 'dead', since: 30 })];
        expect(sortCalls(rows).map(r => r.uuid)).toEqual(['stuck', 'old', 'new', 'nodate']);
    });
});

describe('blockedOn', () => {
    it('is the pending calls targeting the app', () => {
        const rows = [call('1'), call('2', { target: 'c' }), call('3', { status: 'started' })];
        expect(blockedOn(rows, 'b').map(r => r.uuid)).toEqual(['1']);
    });
});
