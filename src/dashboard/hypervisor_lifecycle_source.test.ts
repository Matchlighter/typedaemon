import { EventEmitter } from 'events';
import { hypervisorLifecycleSource } from './hypervisor_lifecycle_source';

function setup(limit?: number) {
    const events = new EventEmitter();
    const orphanIds: string[] = [];
    const configWatches = new Set<() => void>();
    const host: any = {
        on: events.on.bind(events), off: events.off.bind(events),
        listOrphanApplications: async () => [...orphanIds],
        watchConfigEntry: (_e: string, cb: () => void) => { configWatches.add(cb); return () => { configWatches.delete(cb) } },
        working_directory: '/wd',
    };
    const source = hypervisorLifecycleSource(host, limit);
    const seen: any[] = [];
    source.onEvent(e => seen.push(e));
    const fire = (id: string, state: string, over: any = {}) =>
        events.emit('app_lifecycle', { id, options: {}, state, ...over }, state);
    const settle = () => new Promise(r => setImmediate(r));
    return { source, events, orphanIds, configWatches, settle, seen, fire };
}

describe('hypervisorLifecycleSource', () => {
    it('records a start with the cause the instance was restarted for', () => {
        const { source, fire } = setup();
        fire('a', 'started', { options: { human_name: 'Alpha', source: '/wd/a.ts' }, startCause: 'source_change' });
        expect(source.recent()).toEqual([expect.objectContaining({ app: 'a', name: 'Alpha', state: 'started', cause: 'source_change' })]);
    });

    it('reports the previous step (transitional included) and what changed', () => {
        const { source, fire } = setup();
        fire('a', 'compiling');
        fire('a', 'started', { startCause: 'source_change', options: { source: '/wd/apps/a/index.ts' } });
        fire('a', 'dead', { lastError: { message: 'x', phase: 'starting' } });
        const [, started, dead] = source.recent();
        expect(started).toMatchObject({ from: 'compiling', detail: 'Source changed: apps/a/index.ts' });
        expect(dead).toMatchObject({ from: 'started' });
        expect(dead).not.toHaveProperty('detail');
    });

    it('a plain start has no cause', () => {
        const { source, fire } = setup();
        fire('a', 'started');
        expect(source.recent()[0]).not.toHaveProperty('cause');
        expect(source.recent()[0].name).toBe('a');
    });

    it('records death with the error, and its cause when a restart died', () => {
        const { source, fire } = setup();
        fire('a', 'dead', { lastError: { message: 'boom', phase: 'compiling' }, startCause: 'manual' });
        expect(source.recent()[0]).toMatchObject({ state: 'dead', error: 'boom', cause: 'manual' });
    });

    it('carries the id of the log line that reported the failure', () => {
        const { source, fire } = setup();
        fire('a', 'dead', { lastError: { message: 'boom', phase: 'starting', logId: 42 } });
        fire('b', 'dead', { lastError: { message: 'boom', phase: 'starting' } });
        expect(source.recent()[0].errorLogId).toBe(42);
        expect(source.recent()[1]).not.toHaveProperty('errorLogId');
    });

    it('records transitional steps, with the restart cause only on the new instance', () => {
        const { source, fire } = setup();
        fire('a', 'stopping', { startCause: 'source_change', options: { source: '/wd/a.ts' } });
        fire('a', 'stopped');
        fire('a', 'compiling', { startCause: 'source_change', options: { source: '/wd/a.ts' } });
        expect(source.recent().map(e => [e.from, e.state, e.detail])).toEqual([
            [undefined, 'stopping', undefined], ['stopping', 'stopped', undefined], ['stopped', 'compiling', 'Source changed: a.ts'],
        ]);
    });

    it('names the exact config key that restarted the app', () => {
        const { source, fire } = setup();
        fire('lights', 'starting', { startCause: 'config_change', startChanged: ['config.scenes'] });
        fire('lights', 'started', { startCause: 'config_change', startChanged: ['config.scenes', 'logging.level'] });
        fire('x', 'started', { startCause: 'config_change' });
        expect(source.recent().map(e => e.detail)).toEqual(['Config changed: lights.config.scenes', 'Config changed: lights.config.scenes (+1 more)', 'Config changed: x']);
    });

    it('records resumables picked up again', () => {
        const { source, events } = setup();
        events.emit('app_resumed', { id: 'hvac', options: { human_name: 'HVAC' } }, ['preheat', 'cool']);
        expect(source.recent()).toEqual([expect.objectContaining({ app: 'hvac', name: 'HVAC', state: 'resumed', resumed: ['preheat', 'cool'], detail: 'Restored 2 resumables after restart' })]);
    });

    it('records an app that became an orphan, not the ones that already were', async () => {
        const { source, events, orphanIds, configWatches, settle } = setup();
        orphanIds.push('old');
        await settle();
        orphanIds.push('gone');
        [...configWatches].forEach(cb => cb());
        await settle();
        events.emit('orphans_changed');
        await settle();
        expect(source.recent()).toEqual([expect.objectContaining({ app: 'gone', name: 'gone', state: 'orphan', from: 'stopped' })]);
        orphanIds.length = 0; // cleaned up: not an event
        events.emit('orphans_changed');
        await settle();
        expect(source.recent()).toHaveLength(1);
    });

    it('gives increasing ids, notifies listeners, and keeps only the newest `limit`', () => {
        const { source, fire, seen } = setup(2);
        fire('a', 'started'); fire('b', 'started'); fire('c', 'started');
        expect(source.recent().map(e => e.app)).toEqual(['b', 'c']);
        expect(seen.map(e => e.id)).toEqual([1, 2, 3]);
    });

    it('dispose detaches from the hypervisor', () => {
        const { source, fire, events, configWatches } = setup();
        source.dispose();
        fire('a', 'started');
        expect(source.recent()).toEqual([]);
        expect(events.listenerCount('app_resumed')).toBe(0);
        expect(configWatches.size).toBe(0);
    });
});
