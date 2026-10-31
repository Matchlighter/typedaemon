import { diffTopic, keyedRowsTopic, replaceTopic } from "./topics";

const flush = () => new Promise(r => setImmediate(r));

type Row = { key: string; v: number };

describe('keyedRowsTopic', () => {
    function setup(initial: Row[] | undefined) {
        let cb: (() => void) | undefined;
        let current = initial;
        const topic = keyedRowsTopic<any, { rows: Row[] } | undefined, Row>({
            read: () => current && { rows: current },
            onChange: (_p, f) => { cb = f; return () => { cb = undefined } },
        });
        return { topic, fire: () => cb?.(), set: (r?: Row[]) => { current = r }, subscribed: () => !!cb };
    }

    it('emits upserts/removals synchronously for sync sources; unknown subject reads as no rows', () => {
        const { topic, fire, set } = setup([{ key: 'a', v: 1 }, { key: 'b', v: 1 }]);
        const out: any[] = [];
        topic.subscribe({ id: 'x' }, d => out.push(d));
        set([{ key: 'b', v: 2 }, { key: 'c', v: 1 }]);
        fire();
        set(undefined);
        fire();
        expect(out).toEqual([
            { upsert: [{ key: 'b', v: 2 }, { key: 'c', v: 1 }], remove: ['a'] },
            { remove: ['b', 'c'] },
        ]);
    });

    it('snapshot rejects an unknown subject', async () => {
        await expect(setup(undefined).topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('handles async reads in order, each against the previous one, and stops after dispose', async () => {
        const pending: ((rows: Row[]) => void)[] = [];
        let cb!: () => void;
        const topic = keyedRowsTopic<any, { rows: Row[] }, Row>({
            read: () => new Promise(r => pending.push(rows => r({ rows }))),
            onChange: (_p, f) => { cb = f; return () => { cb = undefined as any } },
        });
        const out: any[] = [];
        const off = topic.subscribe({ id: 'x' }, d => out.push(d));
        cb(); cb();
        expect(pending).toHaveLength(1);                 // later reads wait for the one in flight
        pending[0]([{ key: 'a', v: 1 }]); await flush(); // initial
        expect(pending).toHaveLength(2);
        pending[1]([{ key: 'a', v: 2 }]); await flush();
        expect(pending).toHaveLength(3);
        pending[2]([{ key: 'a', v: 3 }]); await flush();
        expect(out).toEqual([{ upsert: [{ key: 'a', v: 2 }] }, { upsert: [{ key: 'a', v: 3 }] }]);
        off();
        expect(cb).toBeUndefined();
    });

    it('uses keyOf/rowsOf when given', () => {
        let cb!: () => void;
        let items = [{ id: 'a', v: 1 }];
        const topic = keyedRowsTopic<any, { items: typeof items }, (typeof items)[0]>({
            read: () => ({ items }),
            onChange: (_p, f) => { cb = f; return () => { } },
            rowsOf: s => s.items,
            keyOf: r => r.id,
        });
        const out: any[] = [];
        topic.subscribe(undefined, d => out.push(d));
        items = [{ id: 'a', v: 2 }];
        cb();
        expect(out).toEqual([{ upsert: [{ id: 'a', v: 2 }] }]);
    });
});

describe('replaceTopic', () => {
    it('emits the fresh state on every change, nothing for an unknown subject', () => {
        let cb!: () => void;
        let cur: { n: number } | undefined = { n: 1 };
        const topic = replaceTopic<any>({ read: () => cur, onChange: (_p, f) => { cb = f; return () => { } } });
        const out: any[] = [];
        topic.subscribe({ id: 'x' }, d => out.push(d));
        cur = { n: 2 }; cb();
        cur = undefined; cb();
        expect(out).toEqual([{ n: 2 }]);
    });
});

describe('diffTopic', () => {
    it('swallows failing async reads and keeps going', async () => {
        let cb!: () => void;
        let fail = true;
        const topic = diffTopic<any, number>({
            read: async () => { if (fail) throw new Error('x'); return 1 },
            onChange: (_p, f) => { cb = f; return () => { } },
            diff: (_p, n) => n === undefined ? undefined : { n },
        });
        const out: any[] = [];
        topic.subscribe(undefined, d => out.push(d));
        cb(); await flush();
        fail = false; cb(); await flush();
        expect(out).toEqual([{ n: 1 }]);
    });
});
