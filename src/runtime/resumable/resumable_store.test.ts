jest.mock('../../hypervisor/current', () => ({ current: { application: { resumableStore: null } } }));
jest.mock('../../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import './resumable_method';
import { CancellableResumablePromise, FailedResume, ResumablePromise, type ResumableDescription } from './resumable_promise';
import { ResumableStore } from './resumable_store';

const description = (over: Partial<ResumableDescription> = {}): ResumableDescription =>
    ({ type: 'resumable', owner: 'APPLICATION', method: 'm', params: [], startedAt: 1, restarts: 0, ...over });

/** A user-visible resumable that settles on demand */
class Described extends CancellableResumablePromise<number> {
    cancelled: any;
    constructor(private info: ResumableDescription | null = description()) { super(); }
    describe() { return this.info ?? undefined; }
    finish(v = 1) { this.resolve(v); }
    protected _cancel(reason?: any) { this.cancelled = reason; this.reject(reason); }
    serialize(ctx: any) { ctx.set_type('described'); ctx.side_effects(true); return {}; }
}

/** Internal plumbing (sleepers, callbacks): tracked but never shown */
class Plumbing extends ResumablePromise<number> {
    serialize(ctx: any) { ctx.set_type('plumbing'); ctx.side_effects(false); return {}; }
}

const flush = () => new Promise(r => setImmediate(r));
let dir: string, store: ResumableStore;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstore-'));
    store = new ResumableStore({ file: path.join(dir, 'state.json') }, {});
    ResumablePromise.get_store = () => store;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A '@resumable' whose owner no longer has the method fails to resume, like after a code change */
const failedResume = (extra: object = {}, deps: string[] = []) => {
    const loaded = ResumablePromise.resumePromises([{
        id: '1', type: '@resumable', dependencies: deps, sideeffect_free: false,
        data: { pending_promise: null, scope: { owner: 'APPLICATION', method: 'gone', parameters: ['a', 2] }, started_at: 5, restarts: 1 },
        ...extra,
    }] as any);
    return loaded['1'] as FailedResume;
};

describe('ResumableStore.list', () => {
    it('announces a new resumable only once its creator has set it up; a listener listing then sees it whole', async () => {
        /** Like `@resumable`: `scope` is assigned by the caller right after `new` */
        class LateScope extends Described {
            scope?: { method: string };
            constructor() { super(); }
            describe() { return description({ method: this.scope!.method }); }
        }
        const seen: string[][] = [];
        store.on('change', () => seen.push(store.list().map(r => r.method)));
        const p = new LateScope();
        p.scope = { method: 'late' };
        const q = new LateScope();
        q.scope = { method: 'later' };
        expect(seen).toEqual([]);
        await flush();
        expect(seen).toEqual([['late', 'later']]);
        expect(store.list().map(r => r.method)).toEqual(['late', 'later']);
        p.finish(); q.finish();
    });

    it('lists described resumables as running with stable unique ids, hiding plumbing', () => {
        const a = new Described(description({ method: 'a' }));
        new Plumbing();
        new Described(null);
        const b = new Described(description({ method: 'b', params: [1] }));
        const rows = store.list();
        expect(rows.map(r => [r.method, r.status])).toEqual([['a', 'running'], ['b', 'running']]);
        expect(new Set(rows.map(r => r.id)).size).toBe(2);
        expect(store.list().map(r => r.id)).toEqual(rows.map(r => r.id));
        a.finish(); b.finish();
    });

    it('drops settled resumables and says so', async () => {
        const changes = jest.fn();
        store.on('change', changes);
        const a = new Described();
        await flush();
        expect(changes).toHaveBeenCalledTimes(1);
        a.finish();
        await flush();
        expect(store.list()).toEqual([]);
        expect(changes).toHaveBeenCalledTimes(2);
    });

    it('does not reuse ids across stores (an app restart makes a new store)', () => {
        const a = new Described();
        const first = store.list()[0].id;
        store = new ResumableStore({ file: path.join(dir, 'b.json') }, {});
        ResumablePromise.get_store = () => store;
        new Described();
        expect(store.list()[0].id).not.toBe(first);
        a.finish();
    });

    it('lists failed resumes with the error, attempts and what was called', () => {
        const f = failedResume();
        const [row] = store.list();
        expect(row).toMatchObject({ status: 'failed', owner: 'APPLICATION', method: 'gone', params: ['a', 2], startedAt: 5, restarts: 1 });
        expect(row.failure!.error).toMatch(/gone|undefined|Cannot read/);
        expect(row.failure!.attempts).toBe(1);
        expect(f).toBeInstanceOf(FailedResume);
    });

    it('lists a failed resume whose persisted frame is corrupt, without its params', () => {
        failedResume({ data: { scope: { owner: 'APPLICATION', method: 'gone' }, frame: { root: { '@': 9 }, objects: [] } } });
        expect(store.list()).toMatchObject([{ status: 'failed', method: 'gone', params: [] }]);
    });

    it('lists the params of a failed resume whose frame holds a promise', () => {
        const frame = { root: { '@': 0 }, objects: [{ parameters: { '@': 1 }, state: { '@': 2 } }, ['a'], { p: { '@': 3 } }, 0], externals: [3] };
        failedResume({ data: { scope: { owner: 'APPLICATION', method: 'gone' }, frame } });
        expect(store.list()).toMatchObject([{ status: 'failed', method: 'gone', params: ['a'] }]);
    });

    it('counts attempts across restarts', async () => {
        failedResume({ failed_attempts: 2 });
        expect(store.list()[0].failure!.attempts).toBe(3);
        await store.save();
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
        expect(saved[0].failed_attempts).toBe(3);
    });

    it('reports suspended once the store suspended them', async () => {
        const a = new Described();
        await store.save();
        expect(store.list()[0].status).toBe('suspended');
        a.finish();
    });
});

describe('ResumableStore.save: given up on at shutdown', () => {
    /** Never reaches a point where it can be persisted */
    class Stuck extends Described {
        protected can_suspend() { return false; }
        protected cannot_suspend_reason() { return 'state.fn is a function'; }
    }
    const timeout = ResumableStore.SUSPEND_TIMEOUT_MS;
    beforeAll(() => { ResumableStore.SUSPEND_TIMEOUT_MS = 20; });
    afterAll(() => { ResumableStore.SUSPEND_TIMEOUT_MS = timeout; });

    it('is listed as failed after the restart, with what was called and why', async () => {
        new Stuck(description({ method: 'stuck', params: [1, 'x', () => 1], startedAt: 7, restarts: 2 }));
        const { failed } = await store.save();
        expect(failed).toHaveLength(1);

        store = new ResumableStore({ file: path.join(dir, 'state.json') }, {});
        expect(await store.load()).toEqual([]);
        const [row] = store.list();
        expect(row).toMatchObject({ status: 'failed', owner: 'APPLICATION', method: 'stuck', startedAt: 7, restarts: 2 });
        expect(row.params).toEqual([1, 'x', expect.stringMatching(/function/)]);
        expect(row.failure!.error).toMatch(/could not be suspended.*state\.fn is a function/);
    });

    it('stays listed until discarded', async () => {
        new Stuck(description({ method: 'stuck' }));
        await store.save();
        for (let restart = 0; restart < 2; restart++) {
            store = new ResumableStore({ file: path.join(dir, 'state.json') }, {});
            await store.load();
            expect(store.list().map(r => [r.method, r.status])).toEqual([['stuck', 'failed']]);
            if (restart == 1) store.discard(store.list()[0].id);
            await flush();
            await store.save();
        }
        expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(false);
    });
});

describe('ResumableStore.cancel', () => {
    it('cancels a running resumable', async () => {
        const a = new Described();
        a.catch(() => { });
        store.cancel(store.list()[0].id, 'why');
        expect(a.cancelled).toBeDefined();
        await flush();
        expect(store.list()).toEqual([]);
    });

    it('rejects an unknown or finished id', async () => {
        const a = new Described();
        const id = store.list()[0].id;
        a.finish();
        await flush();
        expect(() => store.cancel(id, 'why')).toThrow(/no longer/i);
    });

    it('refuses while the app is shutting down', async () => {
        const a = new Described();
        const id = store.list()[0].id;
        await store.save();
        expect(() => store.cancel(id, 'why')).toThrow(/shutting down/i);
        expect(a.cancelled).toBeUndefined();
    });

    it('refuses to cancel a failed resume (it is discarded instead)', () => {
        failedResume();
        expect(() => store.cancel(store.list()[0].id, 'why')).toThrow(/discard/i);
    });
});

describe('ResumableStore.discard', () => {
    it('removes a failed resume so it is not persisted (and so not retried at the next start)', async () => {
        failedResume();
        const changes = jest.fn();
        store.on('change', changes);
        store.discard(store.list()[0].id);
        await flush();
        expect(store.list()).toEqual([]);
        expect(changes).toHaveBeenCalled();
        await store.save();
        expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(false);
    });

    it('is kept without a discard', async () => {
        failedResume();
        await store.save();
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))).toHaveLength(1);
    });

    it('also discards failures that only exist because they wait on the discarded one', async () => {
        const loaded = ResumablePromise.resumePromises([
            { id: '1', type: '@resumable', dependencies: [], sideeffect_free: false, data: { scope: { owner: 'APPLICATION', method: 'inner', parameters: [] } } },
            { id: '2', type: 'callback:nonexistent', dependencies: ['1'], sideeffect_free: false, data: {} },
        ] as any);
        expect(loaded['2']).toBeInstanceOf(FailedResume);
        store.discard(store.list().find(r => r.method === 'inner')!.id);
        await flush();
        await store.save();
        expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(false);
    });

    it('refuses a resumable that is not failed', () => {
        const a = new Described();
        expect(() => store.discard(store.list()[0].id)).toThrow(/not failed/i);
        a.finish();
    });

    it('rejects an unknown id', () => {
        expect(() => store.discard(999999)).toThrow(/no longer/i);
        expect(() => store.discard(NaN)).toThrow(/no longer/i);
    });

    it('refuses while the app is shutting down (what is being saved is settled)', async () => {
        failedResume();
        const id = store.list()[0].id;
        await store.save();
        expect(() => store.discard(id)).toThrow(/shutting down/i);
    });
});
