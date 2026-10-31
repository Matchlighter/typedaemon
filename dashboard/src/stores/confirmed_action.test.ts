import { describe, expect, it } from 'vitest';
import { ConfirmedAction } from './confirmed_action';

const deferred = () => { let resolve!: () => void, reject!: (e: unknown) => void; const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } };

describe('ConfirmedAction', () => {
    it('keeps the confirmation open while the call is in flight, then closes it', async () => {
        const d = deferred();
        const a = new ConfirmedAction<string>({ call: () => d.promise });
        a.request('x');
        const p = a.confirm();
        expect(a.busy).toBe(true);
        expect(a.confirming).toBe('x');
        d.resolve(); await p;
        expect(a.busy).toBe(false);
        expect(a.confirming).toBeUndefined();
        expect(a.error).toBeUndefined();
    });

    it('closeOnConfirm closes it as the call starts', async () => {
        const d = deferred();
        const a = new ConfirmedAction<string>({ call: () => d.promise, closeOnConfirm: true });
        a.request('x');
        const p = a.confirm();
        expect(a.confirming).toBeUndefined();
        expect(a.busy).toBe(true);
        d.resolve(); await p;
    });

    it('reports a rejection (via failure()) and clears it on the next attempt; done() only on success', async () => {
        const done: string[] = [];
        let fail = true;
        const a = new ConfirmedAction<string>({
            call: async () => { if (fail) throw new Error('nope') },
            failure: (t, m) => `Couldn't do ${t}: ${m}`,
            done: t => done.push(t),
        });
        await a.run('x');
        expect(a.error).toBe("Couldn't do x: nope");
        expect(done).toEqual([]);
        fail = false;
        await a.run('x');
        expect(a.error).toBeUndefined();
        expect(done).toEqual(['x']);
    });

    it('uses the bare message by default, and stringifies non-errors', async () => {
        const a = new ConfirmedAction<void>({ call: async () => { throw 'plain' } });
        await a.run();
        expect(a.error).toBe('plain');
    });

    it('confirm without a request does nothing; cancel and dismiss reset', async () => {
        let calls = 0;
        const a = new ConfirmedAction<string>({ call: async () => { calls++ } });
        await a.confirm();
        expect(calls).toBe(0);
        a.request('x'); a.cancel();
        expect(a.confirming).toBeUndefined();
        a.error = 'e'; a.dismiss();
        expect(a.error).toBeUndefined();
    });
});
