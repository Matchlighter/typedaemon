import type { ServerMessage } from '@protocol';
import { describe, expect, it } from 'vitest';
import { ConnectionStore, type SocketLike } from './connection_store';
import { combinedListStatus, TopicStore } from './topic_store';

function setup() {
    let sock!: SocketLike & { sent: any[] };
    const conn = new ConnectionStore({ url: 'ws://h/ws', createSocket: () => (sock = { sent: [], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }) });
    sock.onopen!();
    const serverSend = (m: ServerMessage) => sock.onmessage!({ data: JSON.stringify(m) });
    return { conn, sock, serverSend };
}

describe('TopicStore.listStatus', () => {
    it('is syncing until data arrives, then live; stale when disconnected with data', () => {
        const { conn, sock, serverSend } = setup();
        const t = new TopicStore(conn, 'system');
        const stop = t.activate();
        expect(t.listStatus).toBe('syncing');
        serverSend({ type: 'snapshot', id: 1, data: { version: 'v', startedAt: 1, now: 2 } });
        expect(t.listStatus).toBe('live');
        sock.onclose!();
        expect(t.listStatus).toBe('stale');
        stop();
    });

    it('is error when the server rejects, with or without data', () => {
        const { conn, serverSend } = setup();
        const t = new TopicStore(conn, 'system');
        t.activate();
        serverSend({ type: 'error', id: 1, message: 'nope' });
        expect(t.listStatus).toBe('error');
    });

    it('is syncing before activation', () => {
        expect(new TopicStore(setup().conn, 'system').listStatus).toBe('syncing');
    });
});

describe('combinedListStatus', () => {
    it('syncs until every topic has data, errors if any does', () => {
        const { conn, serverSend } = setup();
        const a = new TopicStore(conn, 'system'), b = new TopicStore(conn, 'apps');
        a.activate(); b.activate();
        expect(combinedListStatus(a, b)).toBe('syncing');
        serverSend({ type: 'snapshot', id: 1, data: { version: 'v', startedAt: 1, now: 2 } });
        expect(combinedListStatus(a, b)).toBe('syncing');
        serverSend({ type: 'snapshot', id: 2, data: { apps: [], orphans: [] } });
        expect(combinedListStatus(a, b)).toBe('live');
        serverSend({ type: 'error', id: 2, message: 'x' });
        expect(combinedListStatus(a, b)).toBe('error');
    });
});
