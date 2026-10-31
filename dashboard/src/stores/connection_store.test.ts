import type { ServerMessage } from '@protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStore, type SocketLike } from './connection_store';

class FakeSocket implements SocketLike {
    static all: FakeSocket[] = [];
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor(public url: string) { FakeSocket.all.push(this); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { this.onclose?.(); }
    // test helpers
    open() { this.onopen?.(); }
    serverSend(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
    serverDrop() { this.onclose?.(); }
}
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

function make() {
    return new ConnectionStore({ url: 'ws://h/ws', createSocket: u => new FakeSocket(u) });
}

describe('ConnectionStore', () => {
    beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = []; });
    afterEach(() => vi.useRealTimers());

    it('subscribes once the socket is open and exposes snapshot data', () => {
        const store = make();
        const sub = store.subscribe('system');
        expect(sub.status).toBe('syncing');
        last().open();
        expect(last().sent).toEqual([{ type: 'subscribe', id: 1, topic: 'system', params: undefined }]);
        last().serverSend({ type: 'snapshot', id: 1, data: { version: 'v', startedAt: 1, now: 2 } });
        expect(sub.status).toBe('live');
        expect(sub.data).toEqual({ version: 'v', startedAt: 1, now: 2 });
    });

    it('merges deltas into the data', () => {
        const store = make();
        const sub = store.subscribe('system');
        last().open();
        last().serverSend({ type: 'snapshot', id: 1, data: { version: 'v', startedAt: 1, now: 2 } });
        last().serverSend({ type: 'delta', id: 1, data: { now: 9 } });
        expect(sub.data).toEqual({ version: 'v', startedAt: 1, now: 9 });
    });

    it("folds deltas with the topic's reducer (a full-snapshot topic replaces, not merges)", () => {
        const store = make();
        const sub = store.subscribe('appConfig', { id: 'a' });
        last().open();
        last().serverSend({ type: 'snapshot', id: 1, data: { config: {}, secrets: [], extra: 1 } as any });
        last().serverSend({ type: 'delta', id: 1, data: { config: { x: 1 } } as any });
        expect(sub.data).toEqual({ config: { x: 1 } });
    });

    it('gives every subscriber of one topic the same data, whoever subscribed first', () => {
        const store = make();
        const a = store.subscribe('apps');
        const b = store.subscribe('apps');
        const row = (id: string) => ({ id, name: id, source: `${id}.ts`, state: 'started', since: 0 }) as any;
        last().open();
        last().serverSend({ type: 'snapshot', id: 1, data: { apps: [row('a')], orphans: [] } });
        last().serverSend({ type: 'delta', id: 1, data: { upsert: [row('b')], orphans: [{ id: 'x' }] } });
        expect(a.data).toBe(b.data);
        expect(a.data!.apps.map(r => r.id)).toEqual(['a', 'b']);
        expect(a.data!.orphans).toEqual([{ id: 'x' }]);
    });

    it('shares one wire subscription between identical subscribers and unsubscribes after the last dispose', () => {
        const store = make();
        const a = store.subscribe('system');
        const b = store.subscribe('system');
        last().open();
        expect(last().sent).toHaveLength(1);
        a.dispose();
        expect(last().sent).toHaveLength(1);
        b.dispose();
        expect(last().sent[1]).toEqual({ type: 'unsubscribe', id: 1 });
    });

    it('goes stale on disconnect, reconnects with backoff, and resubscribes', () => {
        const store = make();
        const sub = store.subscribe('system');
        const first = last();
        first.open();
        first.serverSend({ type: 'snapshot', id: 1, data: { version: 'v', startedAt: 1, now: 2 } });
        expect(store.status).toBe('open');

        first.serverDrop();
        expect(store.status).toBe('reconnecting');
        expect(sub.status).toBe('stale');
        expect(sub.data).toEqual({ version: 'v', startedAt: 1, now: 2 }); // kept while stale

        expect(FakeSocket.all).toHaveLength(1);
        vi.advanceTimersByTime(600);
        expect(FakeSocket.all).toHaveLength(2);
        last().open();
        expect(last().sent).toEqual([{ type: 'subscribe', id: 1, topic: 'system', params: undefined }]);
        last().serverSend({ type: 'snapshot', id: 1, data: { version: 'v2', startedAt: 5, now: 6 } });
        expect(sub.status).toBe('live');
        expect(sub.data).toMatchObject({ version: 'v2' }); // snapshot replaces
    });

    it('backs off exponentially on repeated failures and resets after a successful open', () => {
        const store = make();
        store.subscribe('system');
        last().serverDrop(); // never opened
        vi.advanceTimersByTime(499);
        expect(FakeSocket.all).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(FakeSocket.all).toHaveLength(2);
        last().serverDrop();
        vi.advanceTimersByTime(999);
        expect(FakeSocket.all).toHaveLength(2);
        vi.advanceTimersByTime(1);
        expect(FakeSocket.all).toHaveLength(3);
        last().open();
        last().serverDrop();
        vi.advanceTimersByTime(500);
        expect(FakeSocket.all).toHaveLength(4);
    });

    it('surfaces topic errors on the subscription', () => {
        const store = make();
        const sub = store.subscribe('system');
        last().open();
        last().serverSend({ type: 'error', id: 1, message: 'boom' });
        expect(sub.status).toBe('error');
        expect(sub.error).toBe('boom');
    });

    describe('health / stale', () => {
        it('is live+not stale when open; tracks lastLiveAt from server messages', () => {
            vi.setSystemTime(1000);
            const store = make();
            expect(store.health).toBe('connecting');
            last().open();
            expect(store.health).toBe('live');
            expect(store.stale).toBe(false);
            store.subscribe('system');
            vi.setSystemTime(5000);
            last().serverSend({ type: 'snapshot', id: 1, data: { version: 'v', startedAt: 1, now: 2 } });
            expect(store.lastLiveAt).toBe(5000);
        });

        it('is reconnecting + stale after a drop, freezing lastLiveAt', () => {
            vi.setSystemTime(1000);
            const store = make();
            last().open();
            vi.setSystemTime(2000);
            last().serverDrop();
            vi.setSystemTime(9000);
            expect(store.health).toBe('reconnecting');
            expect(store.stale).toBe(true);
            expect(store.lastLiveAt).toBe(1000);
        });

        it('becomes unreachable after repeated failed attempts, live again on open', () => {
            const store = make();
            last().open();
            last().serverDrop();
            vi.runOnlyPendingTimers(); last().serverDrop();
            expect(store.health).toBe('reconnecting');
            vi.runOnlyPendingTimers(); last().serverDrop();
            expect(store.health).toBe('unreachable');
            vi.runOnlyPendingTimers(); last().open();
            expect(store.health).toBe('live');
        });

        it('retryNow reconnects immediately without waiting for backoff', () => {
            const store = make();
            last().open();
            last().serverDrop();
            const before = FakeSocket.all.length;
            store.retryNow();
            expect(FakeSocket.all.length).toBe(before + 1);
            vi.runOnlyPendingTimers(); // old backoff timer must have been cancelled
            expect(FakeSocket.all.length).toBe(before + 1);
        });

        it('retryNow is a no-op while open', () => {
            const store = make();
            last().open();
            const n = FakeSocket.all.length;
            store.retryNow();
            expect(FakeSocket.all.length).toBe(n);
        });
    });

    describe('call', () => {
        it('sends the action and resolves on ok', async () => {
            const store = make();
            last().open();
            const p = store.call('app.restart', { id: 'a' });
            expect(last().sent.at(-1)).toEqual({ type: 'call', id: expect.any(Number), action: 'app.restart', params: { id: 'a' } });
            last().serverSend({ type: 'result', id: last().sent.at(-1).id, ok: true });
            await expect(p).resolves.toBeUndefined();
        });

        it('resolves with the result data of the action', async () => {
            const store = make();
            last().open();
            const p = store.call('storage.value', { app: 'a', key: 'k' });
            last().serverSend({ type: 'result', id: last().sent.at(-1).id, ok: true, data: { n: 1 } });
            await expect(p).resolves.toEqual({ n: 1 });
        });

        it('rejects with the server message on failure', async () => {
            const store = make();
            last().open();
            const p = store.call('app.stop', { id: 'a' });
            last().serverSend({ type: 'result', id: last().sent.at(-1).id, ok: false, message: 'nope' });
            await expect(p).rejects.toThrow('nope');
        });

        it('rejects immediately when not connected', async () => {
            const store = make();
            await expect(store.call('app.stop', { id: 'a' })).rejects.toThrow(/not connected/i);
        });

        it('rejects in-flight calls when the connection drops', async () => {
            const store = make();
            last().open();
            const p = store.call('app.stop', { id: 'a' });
            last().serverDrop();
            await expect(p).rejects.toThrow(/connection lost/i);
        });

        it('does not collide ids with subscriptions', async () => {
            const store = make();
            const sub = store.subscribe('system');
            last().open();
            const p = store.call('app.stop', { id: 'a' });
            const callId = last().sent.at(-1).id;
            expect(callId).not.toBe(sub.id);
            last().serverSend({ type: 'result', id: callId, ok: true });
            await p;
            expect(sub.status).toBe('syncing');
        });
    });
});
