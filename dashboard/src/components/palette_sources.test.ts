import type { ServerMessage } from '@protocol';
import { describe, expect, it } from 'vitest';
import { ConnectionStore } from '../stores/connection_store';
import { RouteStore } from '../stores/route_store';
import { PaletteSources } from './palette_sources';

function make() {
    let sock: any;
    const conn = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)); }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    let hash = '';
    const route = new RouteStore({ get hash() { return hash; }, set hash(v: string) { hash = v; }, onChange: () => () => { } });
    const src = new PaletteSources(conn, route);
    const send = (m: ServerMessage) => sock.onmessage({ data: JSON.stringify(m) });
    const subId = (topic: string, id?: string) => sock.sent.find((m: any) => m.type === 'subscribe' && m.topic === topic && (!id || m.params?.id === id)).id;
    return { conn, src, sock: () => sock, send, subId, route };
}
const row = { id: 'lights', name: 'lights', source: 'l.ts', state: 'started', since: 0 };

describe('PaletteSources', () => {
    it('subscribes only while open: apps, entities, then storage per app', () => {
        const { src, sock, send, subId } = make();
        src.setOpen(true);
        sock().onopen();
        send({ type: 'snapshot', id: subId('apps'), data: { apps: [row], orphans: [] } } as any);
        expect(sock().sent.map((m: any) => m.topic).sort()).toEqual(['appStorage', 'apps', 'entities']);
        const sid = subId('appStorage', 'lights');
        send({ type: 'snapshot', id: sid, data: { path: 'p', rows: [{ key: 'counter', size: 1, writtenAt: 0, internal: false }] } } as any);
        const storage = src.providers.find(p => p.id === 'storage')!;
        expect(storage.search('counter').map(r => r.label)).toEqual(['lights/counter']);
        src.setOpen(false);
        expect(sock().sent.filter((m: any) => m.type === 'unsubscribe')).toHaveLength(3);
    });

    it('restart runs immediately; stop waits for confirmation', () => {
        const { src, sock } = make();
        sock().onopen?.();
        src.request('lights', 'restart');
        expect(sock().sent.at(-1)).toMatchObject({ type: 'call', action: 'app.restart', params: { id: 'lights' } });
        const n = sock().sent.length;
        src.request('lights', 'stop');
        expect(src.action.confirming).toEqual({ appId: 'lights', action: 'stop' });
        expect(sock().sent).toHaveLength(n);
        void src.action.confirm();
        expect(sock().sent.at(-1)).toMatchObject({ action: 'app.stop' });
        expect(src.action.confirming).toBeUndefined();
    });

    it('cancel drops the pending action', () => {
        const { src } = make();
        src.request('lights', 'stop');
        src.action.cancel();
        expect(src.action.confirming).toBeUndefined();
    });

    it('is loading from open until apps and entities deliver, and dismissError clears the error', () => {
        const { src, sock, send, subId } = make();
        expect(src.loading).toBe(false);
        src.setOpen(true);
        sock().onopen();
        expect(src.loading).toBe(true);
        send({ type: 'snapshot', id: subId('apps'), data: { apps: [], orphans: [] } } as any);
        send({ type: 'snapshot', id: subId('entities'), data: { rows: [] } } as any);
        expect(src.loading).toBe(false);
        src.action.error = 'boom';
        src.action.dismiss();
        expect(src.action.error).toBeUndefined();
    });
});
