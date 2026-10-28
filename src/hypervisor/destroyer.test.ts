jest.mock('./logging', () => ({ logMessage: jest.fn() }));

import { DestroyerStore } from './destroyer';

/** App stand-in whose `_destroyers` registry holds `entries` */
function storeWith(entries: Record<string, { type: string; options?: any }>) {
    const registry = Object.fromEntries(Object.entries(entries).map(([uuid, e]) => [uuid, { uuid, type: e.type, options: e.options ?? {} }]));
    const app: any = { persistedStorage: { getValue: (k: string) => (k === '_destroyers' ? registry : undefined) } };
    return new DestroyerStore(app);
}

describe('DestroyerStore.destroyApplication', () => {
    it('runs every registered destroyer', async () => {
        const ran: string[] = [];
        DestroyerStore.defineDestroyerClass('T-ok-a', async (_app, o: any) => { ran.push(`a${o.n}`) });
        DestroyerStore.defineDestroyerClass('T-ok-b', async () => { ran.push('b') });
        await storeWith({ x: { type: 'T-ok-a', options: { n: 1 } }, y: { type: 'T-ok-b' } }).destroyApplication();
        expect(ran).toEqual(['a1', 'b']);
    });

    it('still runs the others when one fails, then reports every failure', async () => {
        const ran: string[] = [];
        DestroyerStore.defineDestroyerClass('T-fail', async () => { throw new Error('HA is down') });
        DestroyerStore.defineDestroyerClass('T-after', async () => { ran.push('after') });
        const p = storeWith({ x: { type: 'T-fail' }, y: { type: 'T-after' } }).destroyApplication();
        await expect(p).rejects.toThrow(/T-fail.*HA is down/);
        expect(ran).toEqual(['after']);
    });

    it('treats a destroyer it does not know as a failure (its cleanup did not happen)', async () => {
        await expect(storeWith({ x: { type: 'T-never-registered' } }).destroyApplication()).rejects.toThrow(/T-never-registered/);
    });
});
