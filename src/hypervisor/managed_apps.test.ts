import { EventEmitter } from 'events';

jest.mock('./logging', () => ({ createDomainLogger: () => ({ logMessage() { }, close() { } }), NUMERIC_LOG_LEVELS: {} }));

import { AppNamespace } from './managed_apps';

class FakeInstance extends EventEmitter {
    static created: FakeInstance[] = [];
    state = 'initializing';
    constructor(public ctx: any, public options: any) {
        super();
        this.id = ctx.id;
        FakeInstance.created.push(this);
    }
    id: string;
    async _start() { this.state = 'started'; }
    beginShutdown() { this.state = 'stopping'; }
    async _shutdown() { this.state = 'stopped'; }
}

function setup(apps: Record<string, any> = { a: { source: 'a.ts' }, b: { source: 'b.ts' } }) {
    FakeInstance.created = [];
    const hypervisor: any = { state: 'running', logMessage() { } };
    const config = { apps };
    const ns = new AppNamespace<any, any, any>(hypervisor, 'Application', {
        Host: FakeInstance as any,
        getInstanceConfig: id => config.apps[id],
    });
    const overrides: string[] = [];
    ns.on('override_changed', (id: string) => overrides.push(id));
    return { ns, config, overrides };
}

describe('AppNamespace runtime stop override', () => {
    it('stopInstance shuts the app down and marks it overridden', async () => {
        const { ns, overrides } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.stopInstance('a');
        expect(ns.getInstance('a')).toBeUndefined();
        expect(ns.isStoppedOverride('a')).toBe(true);
        expect(ns.isStoppedOverride('b')).toBe(false);
        expect(overrides).toEqual(['a']);
    });

    it('sync does not restart an overridden app', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.stopInstance('a');
        await Promise.all(ns.sync({ a: {}, b: {} }));
        expect(ns.getInstance('a')).toBeUndefined();
        expect(ns.getInstance('b')).toBeDefined();
    });

    it('startInstance clears the override and starts the app from current config', async () => {
        const { ns, overrides } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.stopInstance('a');
        await ns.startInstance('a');
        expect(ns.isStoppedOverride('a')).toBe(false);
        expect(ns.getInstance('a').state).toBe('started');
        expect(overrides).toEqual(['a', 'a']);
    });

    it('restartInstance replaces a running instance with a fresh one', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        const before = ns.getInstance('a');
        await ns.restartInstance('a');
        expect(ns.getInstance('a')).not.toBe(before);
        expect(ns.getInstance('a').state).toBe('started');
    });

    it('restartInstance on an overridden app starts it (clears override)', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.stopInstance('a');
        await ns.restartInstance('a');
        expect(ns.isStoppedOverride('a')).toBe(false);
        expect(ns.getInstance('a').state).toBe('started');
    });

    it('rejects ids that are not configured', async () => {
        const { ns } = setup();
        await expect(ns.startInstance('nope')).rejects.toThrow(/not configured/);
    });

    it('clearOverrides clears only the given ids and returns those that were overridden', async () => {
        const { ns, overrides } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.stopInstance('a');
        await ns.stopInstance('b');
        overrides.length = 0;
        expect(ns.clearOverrides(['a', 'zzz'])).toEqual(['a']);
        expect(ns.isStoppedOverride('a')).toBe(false);
        expect(ns.isStoppedOverride('b')).toBe(true);
        expect(overrides).toEqual(['a']);
    });
});

describe('AppNamespace.withExclusiveAccess (offline work on an instance\'s files)', () => {
    const tick = () => new Promise(r => setImmediate(r));

    it('holds back a start until the work is done', async () => {
        const { ns } = setup();
        let release: () => void;
        const order: string[] = [];
        const work = ns.withExclusiveAccess('a', async live => {
            expect(live).toBeUndefined();
            await new Promise<void>(r => { release = r });
            order.push('work done');
        });
        await tick();
        const started = ns.startInstance('a').then(() => order.push('started'));
        await tick(); await tick();
        expect(order).toEqual([]);
        release!();
        await Promise.all([work, started]);
        expect(order).toEqual(['work done', 'started']);
    });

    it('waits for a start already past the gate, then hands over the live instance', async () => {
        const { ns } = setup();
        let finishStart: () => void;
        const origStart = FakeInstance.prototype._start;
        FakeInstance.prototype._start = function () { return new Promise<void>(r => { finishStart = () => { this.state = 'started'; r() } }) };
        try {
            const starting = ns.startInstance('a');
            await tick();
            let seen: any = 'not called';
            const work = ns.withExclusiveAccess('a', async live => { seen = live });
            await tick();
            expect(seen).toBe('not called');
            finishStart!();
            await Promise.all([starting, work]);
            expect(seen).toBe(ns.getInstance('a'));
        } finally {
            FakeInstance.prototype._start = origStart;
        }
    });

    it('holds back a shutdown of the live instance until the work is done', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        let release: () => void;
        let stateInWork: string;
        const work = ns.withExclusiveAccess('a', async live => {
            await new Promise<void>(r => { release = r });
            stateInWork = live.state;
        });
        await tick();
        const stopped = ns.stopInstance('a');
        await tick(); await tick();
        release!();
        await Promise.all([work, stopped]);
        expect(stateInWork!).toBe('started');
        expect(ns.getInstance('a')).toBeUndefined();
    });

    it('runs the work of one id one at a time and does not block other ids or fail later work', async () => {
        const { ns } = setup();
        const order: string[] = [];
        const first = ns.withExclusiveAccess('a', async () => { await tick(); order.push('1'); throw new Error('x') });
        const second = ns.withExclusiveAccess('a', async () => { order.push('2') });
        await ns.withExclusiveAccess('b', async () => { order.push('b') });
        await expect(first).rejects.toThrow('x');
        await second;
        expect(order).toEqual(['b', '1', '2']);
    });
});

describe('AppNamespace start cause', () => {
    it('a first start has no cause', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        expect(ns.getInstance('a').startCause).toBeUndefined();
    });

    it('restartInstance records a manual restart', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.restartInstance('a');
        expect(ns.getInstance('a').startCause).toBe('manual');
    });

    it('reinitializeInstance records the given cause, and a later start does not inherit it', async () => {
        const { ns } = setup();
        await Promise.all(ns.sync({ a: {}, b: {} }));
        await ns.reinitializeInstance(ns.getInstance('a'), 'source_change');
        await new Promise(r => setTimeout(r, 250));
        expect(ns.getInstance('a').startCause).toBe('source_change');
        await ns.stopInstance('a');
        await ns.startInstance('a');
        expect(ns.getInstance('a').startCause).toBeUndefined();
    });
});

describe('AppNamespace shutdown', () => {
    it('marks a still-starting instance stopping right away instead of after its start finishes', async () => {
        const { ns } = setup();
        let finishStart!: () => void;
        FakeInstance.prototype._start = function () { return new Promise<void>(r => { finishStart = () => { this.state = 'started'; r() } }) };
        const starting = ns.sync({ a: {} });
        await new Promise(r => setImmediate(r));
        const inst = ns.getInstance('a');
        const stopping = ns.stopInstance('a');
        await new Promise(r => setImmediate(r));
        expect(inst.state).toBe('stopping');
        finishStart();
        await Promise.all([...starting, stopping]);
        expect(inst.state).toBe('stopped');
    });
});
