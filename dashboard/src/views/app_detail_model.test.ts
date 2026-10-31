import type { AppRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { actionsFor, showOverrideNotice } from './app_detail_model';

const row = (state: AppRow['state'], over: Partial<AppRow> = {}): AppRow => ({ id: 'a', name: 'a', source: 'a.ts', state, since: 0, ...over });

describe('actionsFor', () => {
    it.each([
        ['started', ['restart', 'stop']],
        ['starting', ['restart', 'stop']],
        ['dead', ['restart', 'stop']],
        ['stopped', ['start']],
        ['stopping', []],
    ] as const)('%s -> %j', (state, expected) => {
        expect(actionsFor(row(state))).toEqual(expected);
    });
});

describe('showOverrideNotice', () => {
    it('is shown for an overridden app that is stopping or stopped', () => {
        expect(showOverrideNotice(row('stopped', { stoppedOverride: true }))).toBe(true);
        expect(showOverrideNotice(row('stopping', { stoppedOverride: true }))).toBe(true);
    });
    it('is not shown otherwise', () => {
        expect(showOverrideNotice(row('stopped'))).toBe(false);
        expect(showOverrideNotice(row('started'))).toBe(false);
    });
});
