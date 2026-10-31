// @vitest-environment happy-dom
import type { ScheduleRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));

// Installed before the shared clock is created (it keeps the `Date.now` it was built with) and kept for the whole file
vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
const NOW = new Date('2026-10-19T12:00:00Z').getTime();
const row = (key: string, over: Partial<ScheduleRow> = {}): ScheduleRow =>
    ({ key, expression: "run_every('5m')", kind: 'interval', method: 'poll', nextAt: NOW + 300_000, ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const snapshot = (rows: ScheduleRow[]) => serverSend({ type: 'snapshot', id: 1, data: { rows } });
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });
const rowEls = () => [...host.querySelectorAll('.sched-row:not(.sched-head)')];

async function mount() {
    const { AppSchedulesTab } = await import('./AppSchedulesTab');
    await act(async () => { root.render(<AppSchedulesTab appId="lights" />) });
    act(() => sock.current.onopen());
}

beforeEach(async () => {
    vi.setSystemTime(NOW);
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove() });

describe('App schedules tab', () => {
    it('subscribes to appSchedules for its app and shows syncing first', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'appSchedules', params: { id: 'lights' } });
        expect(host.textContent).toContain('Syncing');
    });

    it('lists every kind of schedule with its expression as written, kind and method', async () => {
        await mount();
        await snapshot([
            row('1'),
            row('2', { expression: 'MON-FRI 6:45 AM', kind: 'cron', method: 'morning' }),
            row('3', { expression: 'sunset-0:30', kind: 'sun', method: 'lights_on' }),
            row('4', { expression: "run_in('10s')", kind: 'at', method: 'later' }),
        ]);
        expect(rowEls().map(r => [r.querySelector('.sched-expr')!.textContent, r.textContent])).toEqual([
            ["run_every('5m')", expect.stringContaining('interval')],
            ['MON-FRI 6:45 AM', expect.stringContaining('cron')],
            ['sunset-0:30', expect.stringContaining('sun')],
            ["run_in('10s')", expect.stringContaining('at')],
        ]);
        expect(rowEls()[1].querySelector('.sched-method')!.textContent).toBe('morning');
    });

    it('counts down to the next fire as the clock ticks', async () => {
        await mount();
        await snapshot([row('1')]);
        expect(rowEls()[0].querySelector('.sched-next .reltime-rel')!.textContent).toBe('in 5m 0s');
        await act(async () => { vi.advanceTimersByTime(3000) });
        expect(rowEls()[0].querySelector('.sched-next .reltime-rel')!.textContent).toBe('in 4m 57s');
    });

    it('shows the last fire and result after the schedule fires, and the new next fire', async () => {
        await mount();
        await snapshot([row('1')]);
        expect(rowEls()[0].querySelector('.sched-last')!.textContent).toBe('—');
        await delta({ upsert: [row('1', { lastAt: NOW, lastResult: 'error', nextAt: NOW + 600_000 })] });
        expect(rowEls()[0].querySelector('.sched-last')!.textContent).toBe('06:00:00');
        expect(rowEls()[0].querySelector('.sched-result')!.textContent).toContain('error');
        expect(rowEls()[0].querySelector('.sched-next .reltime-rel')!.textContent).toBe('in 10m 0s');
    });

    it('drops and recreates rows when the app restarts, keeping registration order', async () => {
        await mount();
        await snapshot([row('1'), row('2', { method: 'second' })]);
        await delta({ remove: ['1', '2'] });
        expect(host.textContent).toContain('No schedules');
        await delta({ upsert: [row('12', { method: 'later' }), row('3', { method: 'earlier' })] });
        expect(rowEls().map(r => r.querySelector('.sched-method')!.textContent)).toEqual(['earlier', 'later']);
    });

    it('shows the empty state when the app has no schedules', async () => {
        await mount();
        await snapshot([]);
        expect(host.textContent).toContain('No schedules');
        expect(rowEls()).toHaveLength(0);
    });

    it('shows the error state when the subscription fails', async () => {
        await mount();
        serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' } as any);
        expect(host.textContent).toContain("Couldn't load schedules");
        expect(host.textContent).toContain('Unknown app: lights');
    });
});
