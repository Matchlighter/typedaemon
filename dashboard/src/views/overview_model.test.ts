import type { AppRow, CrossCallRow, GlobalScheduleRow, LifecycleEvent, LifecycleSnapshot, PluginRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { applyLifecycleDelta, attentionItems, causeLabel, entitySummary, feedEntries, healthSummary, upNext } from './overview_model';

const app = (id: string, state: AppRow['state'] = 'started', over: Partial<AppRow> = {}): AppRow =>
    ({ id, name: id, source: `apps/${id}.ts`, state, since: 0, ...over });
const plugin = (id: string, over: Partial<PluginRow> = {}): PluginRow =>
    ({ id, type: 'mqtt', state: 'started', since: 0, connection: 'connected', config: {}, ...over });
const call = (over: Partial<CrossCallRow> = {}): CrossCallRow =>
    ({ uuid: 'c1', source: 'a', target: 'b', method: 'm', status: 'pending', ...over });
const input = (over: Partial<Parameters<typeof attentionItems>[0]> = {}) =>
    ({ apps: [] as AppRow[], orphans: [] as { id: string }[], plugins: [] as PluginRow[], calls: [] as CrossCallRow[], ...over });

describe('healthSummary', () => {
    it('counts apps by segment, with in-flight apps as running', () => {
        const s = healthSummary(input({ apps: [app('a'), app('b', 'compiling'), app('c', 'dead'), app('d', 'stopped')] }));
        expect(s.apps).toEqual({ total: 4, running: 2, dead: 1, stopped: 1, started: 1, starting: 1 });
    });

    it('counts plugins that are up and connected', () => {
        const s = healthSummary(input({ plugins: [plugin('a'), plugin('b', { connection: 'disconnected' }), plugin('c', { state: 'stopped' }), plugin('d', { connection: undefined })] }));
        expect(s.plugins).toEqual({ total: 4, ok: 2 });
    });

    it('counts orphans and failed resumes (summed over apps)', () => {
        const s = healthSummary(input({ orphans: [{ id: 'x' }], apps: [app('a', 'started', { failedResumes: 2 }), app('b', 'started', { failedResumes: 1 }), app('c')] }));
        expect(s.orphans).toBe(1);
        expect(s.failedResumes).toBe(3);
    });
});

describe('healthSummary resumables', () => {
    it('sums resumables over apps', () => {
        expect(healthSummary(input({ apps: [app('a', 'started', { resumables: 2 }), app('b')] })).resumables).toBe(2);
    });
});

describe('entitySummary', () => {
    it('counts linked/unlinked and what orphans left in HA', () => {
        const e = (key: string, app: string, linked: boolean, orphan?: true) => ({ key, app, linked, orphan }) as any;
        expect(entitySummary([e('1', 'a', true), e('2', 'x', false, true), e('3', 'x', false, true)]))
            .toEqual({ total: 3, linked: 1, unlinked: 2, leftBehind: { x: 2 } });
    });
});

describe('attentionItems', () => {
    it('is empty when everything is fine, including an app stopped on purpose', () => {
        expect(attentionItems(input({ apps: [app('a'), app('b', 'stopped', { stoppedOverride: true })], plugins: [plugin('p')] }))).toEqual([]);
    });

    it('flags a dead app with its error, linking to the app', () => {
        const [item] = attentionItems(input({ apps: [app('lights', 'dead', { error: { message: 'boom', phase: 'compiling' } })] }));
        expect(item).toMatchObject({ severity: 'error', badge: { kind: 'app', state: 'dead' }, subject: 'lights', text: 'failed while compiling', detail: 'boom', detailTone: 'error', action: 'View error', href: '#/apps/lights' });
    });

    it('flags a plugin that is down and links to it', () => {
        const items = attentionItems(input({ plugins: [plugin('mqtt', { connection: 'disconnected', target: 'mqtt://b' })] }));
        expect(items).toEqual([expect.objectContaining({ severity: 'error', subject: 'mqtt', text: 'is disconnected', href: '#/plugins/mqtt' })]);
    });

    it('flags a reconnecting plugin and a stopped plugin as warnings (stopped is not an error)', () => {
        const items = attentionItems(input({ plugins: [plugin('a', { connection: 'reconnecting' }), plugin('b', { state: 'stopped', connection: undefined })] }));
        expect(items.map(i => [i.severity, i.subject, i.text])).toEqual([['warn', 'a', 'is reconnecting'], ['warn', 'b', 'is stopped']]);
    });

    it('flags failed resumes per app, linking to its Resumables tab', () => {
        const [item] = attentionItems(input({ apps: [app('a', 'started', { failedResumes: 2 })] }));
        expect(item).toMatchObject({ severity: 'warn', subject: 'a', text: 'has 2 resumables that failed to resume', href: '#/apps/a/resumables' });
    });

    it('flags orphans needing cleanup, linking to the orphan page', () => {
        const [item] = attentionItems(input({ orphans: [{ id: 'old' }] }));
        expect(item).toMatchObject({ severity: 'warn', subject: 'old', text: 'removed from config', action: 'Review & clean up', href: '#/apps/old' });
    });

    it('summarizes what an orphan left behind', () => {
        const summary = { removedAt: 5, entities: 3, storageKeys: 0, dirBytes: 48 * 1024, destroyers: ['A', 'B'] };
        const [item] = attentionItems(input({ orphans: [{ id: 'old', summary }] }));
        expect(item).toMatchObject({ at: 5, detail: '3 entities still in HA · 2 pending destroyers · operating dir 48.0 KB' });
    });

    it('flags calls stuck on a dead target, linking to the System page', () => {
        const items = attentionItems(input({ calls: [call({ targetState: 'dead' }), call({ uuid: 'c2', targetState: 'started' })] }));
        expect(items).toEqual([expect.objectContaining({ severity: 'error', badge: { kind: 'call', state: 'pending' }, subject: 'Cross-app call stuck', text: 'target app is dead', detail: 'a → b.m()', action: 'View call', href: '#/system' })]);
    });

    it('lists errors before warnings, keeping order within a severity', () => {
        const items = attentionItems(input({ orphans: [{ id: 'o' }], apps: [app('x', 'dead'), app('y', 'dead')] }));
        expect(items.map(i => i.subject)).toEqual(['x', 'y', 'o']);
    });
});

describe('lifecycle feed', () => {
    const ev = (id: number): LifecycleEvent => ({ id, ts: id, app: 'a', name: 'a', state: 'started' });

    it('appends deltas, keeping the newest 200', () => {
        let cur: LifecycleSnapshot = { events: [] };
        for (let i = 1; i <= 205; i++) cur = applyLifecycleDelta(cur, { append: [ev(i)] });
        expect(cur.events).toHaveLength(200);
        expect(cur.events[0].id).toBe(6);
        expect(cur.events[199].id).toBe(205);
    });

    it('words the cause of a restart', () => {
        expect(causeLabel('source_change')).toBe('after source change');
        expect(causeLabel('config_change')).toBe('after config change');
        expect(causeLabel('manual')).toBe('from the dashboard');
        expect(causeLabel('plugin_started')).toBe('after a plugin it needs started');
        expect(causeLabel(undefined)).toBeUndefined();
    });
});

describe('feedEntries', () => {
    const e = (id: number, app: string, state: LifecycleEvent['state'], over: Partial<LifecycleEvent> = {}): LifecycleEvent => ({ id, ts: id, app, name: app, state, ...over });

    it('is newest first and carries the server-reported `from`', () => {
        const out = feedEntries([e(1, 'a', 'started', { from: 'starting' }), e(2, 'b', 'started'), e(3, 'a', 'dead', { error: 'x', from: 'started' })]);
        expect(out.map(x => x.event.id)).toEqual([3, 2, 1]);
        expect(out.map(x => x.from)).toEqual(['started', undefined, 'starting']);
    });

    it('prefers the server detail as reason', () => {
        const out = feedEntries([e(1, 'a', 'started', { cause: 'source_change', detail: 'Source changed: apps/a.ts' })]);
        expect(out[0].reason).toBe('Source changed: apps/a.ts');
    });

    it('gives a reason, except a death which has its error', () => {
        const out = feedEntries([e(1, 'a', 'started'), e(2, 'a', 'started', { cause: 'config_change' }), e(3, 'a', 'dead', { error: 'x' }), e(4, 'a', 'dead'), e(5, 'a', 'stopped')]);
        expect(out.map(x => x.reason)).toEqual(['Stopped', 'Died', undefined, 'Restarted after config change', 'Started']);
    });
});

describe('feedEntries transitions', () => {
    const e = (id: number, state: LifecycleEvent['state'], over: Partial<LifecycleEvent> = {}): LifecycleEvent => ({ id, ts: id, app: 'a', name: 'a', state, ...over });

    it('words the transition and picks the colour state', () => {
        const out = feedEntries([e(1, 'starting', { from: 'compiling' }), e(2, 'orphan', { from: 'stopped' }), e(3, 'resumed', { resumed: ['x', 'y'] })]).reverse();
        expect(out.map(x => [x.transition, x.tone.state])).toEqual([['compiling → starting', 'starting'], ['stopped → orphan', 'orphan'], ['resumed x, y', 'started']]);
    });

    it('only transitional steps with a cause need a reason', () => {
        const out = feedEntries([e(1, 'compiling'), e(2, 'compiling', { cause: 'manual' }), e(3, 'stopping')]).reverse();
        expect(out.map(x => x.reason)).toEqual([undefined, 'Restarted from the dashboard', undefined]);
    });
});

describe('upNext', () => {
    const r = (key: string, nextAt?: number): GlobalScheduleRow => ({ key, app: 'a', expression: 'x', kind: 'cron', method: 'm', nextAt });
    it('takes the soonest pending fires', () => {
        expect(upNext([r('1', 30), r('2'), r('3', 10), r('4', 20)], 2).map(x => x.key)).toEqual(['3', '4']);
    });
});
