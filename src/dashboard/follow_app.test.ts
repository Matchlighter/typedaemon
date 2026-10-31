import { EventEmitter } from 'events';
import { followAppEmitter, followAppInstance, onAppLifecycle, onDistinct } from './follow_app';

function setup(initial?: any) {
    const events = new EventEmitter();
    let current = initial;
    const host = {
        getApplication: () => current,
        on: (e: string, cb: any) => events.on(e, cb),
        off: (e: string, cb: any) => events.off(e, cb),
    } as any;
    return { host, events, set: (a: any) => { current = a } };
}

describe('followAppInstance', () => {
    it('binds the current instance, rebinds (unbinding first) on its lifecycle and notifies', () => {
        const a = { id: 'a' }, a2 = { id: 'a' };
        const { host, events } = setup(a);
        const log: string[] = [];
        const cb = jest.fn();
        const off = followAppInstance(host, 'a', (app, state) => { log.push(`bind ${app === a ? 1 : app === a2 ? 2 : '-'} ${state}`); return () => { log.push('unbind') } }, cb);
        expect(log).toEqual(['bind 1 undefined']);
        events.emit('app_lifecycle', { id: 'other' }, 'started');
        expect(cb).not.toHaveBeenCalled();
        events.emit('app_lifecycle', a2, 'starting');
        expect(log).toEqual(['bind 1 undefined', 'unbind', 'bind 2 starting']);
        expect(cb).toHaveBeenCalledTimes(1);
        off();
        expect(log.at(-1)).toBe('unbind');
        events.emit('app_lifecycle', a2, 'started');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('binds undefined when there is no instance', () => {
        const { host } = setup();
        const bind = jest.fn();
        followAppInstance(host, 'a', bind, () => { });
        expect(bind).toHaveBeenCalledWith(undefined, undefined);
    });
});

describe('onAppLifecycle', () => {
    it('passes app and state, filters by id when given, and unsubscribes', () => {
        const { host, events } = setup();
        const all = jest.fn(), one = jest.fn();
        const offAll = onAppLifecycle(host, undefined, all);
        const offOne = onAppLifecycle(host, 'a', one);
        const a = { id: 'a' }, b = { id: 'b' };
        events.emit('app_lifecycle', a, 'started');
        events.emit('app_lifecycle', b, 'dead');
        expect(all.mock.calls).toEqual([[a, 'started'], [b, 'dead']]);
        expect(one.mock.calls).toEqual([[a, 'started']]);
        offAll(); offOne();
        events.emit('app_lifecycle', a, 'stopped');
        expect(all).toHaveBeenCalledTimes(2);
        expect(one).toHaveBeenCalledTimes(1);
    });
});

describe('followAppEmitter', () => {
    it('listens to every emitter of the current instance, moves to the new instance on restart, and stops on dispose', () => {
        const mk = () => ({ id: 'a', x: new EventEmitter(), y: new EventEmitter() });
        const a = mk(), a2 = mk();
        const { host, events } = setup(a);
        const cb = jest.fn();
        const off = followAppEmitter(host, 'a', cb, app => [(app as any)?.x, (app as any)?.y, undefined]);
        a.x.emit('change'); a.y.emit('change');
        expect(cb).toHaveBeenCalledTimes(2);
        events.emit('app_lifecycle', a2, 'starting');
        expect(cb).toHaveBeenCalledTimes(3);
        a.x.emit('change');
        a2.y.emit('change');
        expect(cb).toHaveBeenCalledTimes(4);
        off();
        a2.x.emit('change');
        expect(cb).toHaveBeenCalledTimes(4);
    });
});

describe('onDistinct', () => {
    it('fires only when the read value changed', () => {
        let v = { n: 1 };
        const cb = jest.fn();
        const check = onDistinct(() => v, cb);
        check();
        expect(cb).not.toHaveBeenCalled();
        v = { n: 1 };
        check();
        expect(cb).not.toHaveBeenCalled();
        v = { n: 2 };
        check();
        check();
        expect(cb).toHaveBeenCalledTimes(1);
    });
});
