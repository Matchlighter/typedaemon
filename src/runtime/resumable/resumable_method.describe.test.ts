jest.mock('../../hypervisor/current', () => ({ current: { application: { resumableStore: null, unsafe_vm: { sandbox: { setTimeout: () => 0, clearTimeout: () => { } } } } } }));
jest.mock('../../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import { ResumableMethod, resumable } from './resumable_method';
import { ResumablePromise } from './resumable_promise';
import { ResumableStore } from './resumable_store';
import { sleep_until } from '../sleep';
import { Executor } from '../regen_executor';

let store: ResumableStore;
beforeEach(() => {
    store = new ResumableStore({ file: '/nonexistent/state.json' }, {});
    ResumablePromise.get_store = () => store;
});

/** Just enough of an Executor for the method to describe/serialize itself */
const fakeExecutor = (over: object = {}): any => ({
    options: { marked_locs: [] }, state: {}, _started: true, pending_promise: null, actionType: 'next', ...over,
});

const method = (executor = fakeExecutor(), params: unknown[] = ['bedroom', 21], isScript = false) => {
    const owner = {};
    resumable.register_context('APPLICATION', owner, true);
    const m = new ResumableMethod<any>(executor);
    m.scope = { owner, method: 'preheat', parameters: params };
    if (isScript) m.markAsScript();
    return m;
};

describe('ResumableMethod.describe', () => {
    it('says who was called with what, and when it started', () => {
        const before = Date.now();
        const d = method().describe()!;
        expect(d).toMatchObject({ type: 'resumable', owner: 'APPLICATION', method: 'preheat', params: ['bedroom', 21], restarts: 0 });
        expect(d.startedAt).toBeGreaterThanOrEqual(before);
        expect(d.wait).toBeUndefined();
    });

    it('is a script when it is a script run', () => {
        expect(method(fakeExecutor(), [], true).describe()!.type).toBe('script');
    });

    it('waits on what its executor awaits', () => {
        const until = Date.now() + 60_000;
        const s = sleep_until(new Date(until));
        const d = method(fakeExecutor({ pending_promise: s })).describe()!;
        expect(d.wait).toEqual({ kind: 'sleep', until });
        s.cancel();
    });

    it('announces what it awaits next', () => {
        const m = method(new Executor(function* () { }() as any, { marked_locs: [] } as any));
        const changes = jest.fn();
        store.on('change', changes);
        m.executor.invoke_promise(sleep_until(new Date(Date.now() + 60_000)));
        expect(changes).toHaveBeenCalled();
    });
});

describe('ResumableMethod persistence', () => {
    it('keeps its start time, script-ness and counts the restart', () => {
        const m = method(fakeExecutor(), ['a'], true);
        const data = m.serialize({ ref: () => null, set_type() { }, side_effects() { } } as any);
        expect(data.started_at).toBe(m.describe()!.startedAt);
        expect(data.script).toBe(true);
        expect(data.restarts).toBe(0);
    });
});
