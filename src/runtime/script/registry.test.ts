jest.mock('../../hypervisor/current', () => ({ current: { application: {} } }));
jest.mock('../../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import { ScriptRegistry } from './registry';
import { ScriptStateStore } from './store';

const item = (over: object = {}): any => ({ cancel: jest.fn(), start: jest.fn(), ...over });

describe('ScriptRegistry', () => {
    it('lists defined scripts with their mode and limit, even when idle', () => {
        const reg = new ScriptRegistry();
        reg.define('single_one', { mode: 'single' });
        reg.define('par', { mode: 'parallel', limit: 3 });
        reg.define('free', { mode: 'queued', limit: false });
        expect(reg.list()).toEqual([
            { name: 'single_one', mode: 'single', limit: 1, running: 0, queued: 0, runs: [] },
            { name: 'par', mode: 'parallel', limit: 3, running: 0, queued: 0, runs: [] },
            { name: 'free', mode: 'queued', limit: null, running: 0, queued: 0, runs: [] },
        ]);
    });

    it('defining again keeps the stores that are attached', () => {
        const reg = new ScriptRegistry();
        reg.define('s', { mode: 'queued' });
        const store = new ScriptStateStore({ mode: 'queued' });
        reg.attach('s', store);
        store.trackPending(item(), ['a']);
        reg.define('s', { mode: 'queued' });
        expect(reg.list()[0].queued).toBe(1);
    });

    it('counts running and queued runs across the stores of a script, announcing every change', () => {
        const reg = new ScriptRegistry();
        reg.define('s', { mode: 'queued', limit: 5 });
        const a = new ScriptStateStore({ mode: 'queued', limit: 5 });
        const b = new ScriptStateStore({ mode: 'queued', limit: 5 });
        reg.attach('s', a);
        reg.attach('s', b);
        const changes = jest.fn();
        reg.on('change', changes);

        const first = item({ start: jest.fn() });
        a.trackPending(first, ['evening']);
        a.refill();
        b.trackPending(item(), ['dusk']);
        expect(changes).toHaveBeenCalled();

        // `queued` mode runs one at a time: b's single run starts since each store has its own slot
        const [row] = reg.list();
        expect(row.running).toBe(1);
        expect(row.queued).toBe(1);
        expect(row.runs.map(r => [r.params, r.queued])).toEqual([[['evening'], false], [['dusk'], true]]);

        a.checkin(first);
        expect(reg.list()[0].running).toBe(0);
    });

    it('stops reporting a store once it is detached (it emptied itself)', () => {
        const reg = new ScriptRegistry();
        reg.define('s', { mode: 'single' });
        const store = new ScriptStateStore({ mode: 'single' });
        reg.attach('s', store);
        store.trackPending(item());
        reg.detach('s', store);
        expect(reg.list()[0].queued).toBe(0);
        const changes = jest.fn();
        reg.on('change', changes);
        store.trackPending(item());
        expect(changes).not.toHaveBeenCalled();
    });

    it('cancels a running run by id', () => {
        const reg = new ScriptRegistry();
        reg.define('s', { mode: 'parallel' });
        const store = new ScriptStateStore({ mode: 'parallel' });
        reg.attach('s', store);
        const run = item();
        store.trackPending(run, []);
        store.refill();
        const [{ id }] = reg.list()[0].runs;
        reg.cancelRun('s', id, 'why');
        expect(run.cancel).toHaveBeenCalledWith('why');
    });

    it('refuses to cancel a run that is not running any more, or a queued one', () => {
        const reg = new ScriptRegistry();
        reg.define('s', { mode: 'single' });
        const store = new ScriptStateStore({ mode: 'single' });
        reg.attach('s', store);
        const a = item(), b = item();
        store.trackPending(a); store.trackPending(b);
        store.refill();
        const queued = reg.list()[0].runs.find(r => r.queued)!;
        expect(() => reg.cancelRun('s', queued.id, 'why')).toThrow(/queued/i);
        expect(() => reg.cancelRun('s', 123456, 'why')).toThrow(/no longer/i);
        expect(() => reg.cancelRun('nope', 1, 'why')).toThrow(/no such script/i);
    });
});
