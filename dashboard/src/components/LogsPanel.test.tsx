// @vitest-environment happy-dom
import type { LogRow } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogsViewState } from '../views/logs_view_state';
import { LogsPanel, type LogsPanelProps } from './LogsPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(25);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return parseInt((this.firstElementChild as HTMLElement | null)?.style.height || '0');
    });
    HTMLElement.prototype.scrollTo = function (this: HTMLElement, opts: any) { this.scrollTop = opts.top; this.dispatchEvent(new Event('scroll')) } as any;
});
afterEach(() => vi.restoreAllMocks());

let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const row = (id: number, over: Partial<LogRow> = {}): LogRow => ({ id, ts: id, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: `line ${id}`, ...over });
const many = (n: number, over: (i: number) => Partial<LogRow> = () => ({})) => Array.from({ length: n }, (_, i) => row(i + 1, over(i + 1)));

let state: LogsViewState;
beforeEach(() => { state = new LogsViewState() });
const render = (p: Partial<LogsPanelProps> & { rows: LogRow[] }) =>
    act(() => root.render(<LogsPanel state={state} status="live" {...p} />));
const lines = () => [...host.querySelectorAll('.log-msg')].map(e => e.textContent);
const btn = (label: RegExp) => [...host.querySelectorAll('button')].find(b => label.test(b.textContent!)) as HTMLButtonElement;
const click = (b: HTMLButtonElement) => act(() => b.click());
const type = (value: string) => {
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

describe('LogsPanel: states', () => {
    it('says it is syncing until the first snapshot', () => {
        render({ rows: [], status: 'syncing' });
        expect(host.textContent).toContain('Syncing');
        expect(host.querySelector('.loglist')).toBeNull();
    });

    it('shows the error', () => {
        render({ rows: [], status: 'error', error: 'Unknown app: x' });
        expect(host.textContent).toContain('Unknown app: x');
    });

    it('explains an empty log', () => {
        render({ rows: [], emptyHint: 'Nothing logged yet.' });
        expect(host.textContent).toContain('No log lines');
        expect(host.textContent).toContain('Nothing logged yet.');
    });

    it('tells apart "nothing logged" from "everything filtered out"', () => {
        render({ rows: many(3) });
        type('zzz');
        expect(host.textContent).toContain('No lines match');
        expect(host.textContent).not.toContain('No log lines');
    });
});

describe('LogsPanel: filters', () => {
    it('channel: User / Manager / Both', () => {
        render({ rows: [row(1), row(2, { channel: 'manager', message: 'td says' })] });
        expect(lines()).toEqual(['line 1', 'td says']);
        click(btn(/^Manager$/));
        expect(lines()).toEqual(['td says']);
        click(btn(/^User$/));
        expect(lines()).toEqual(['line 1']);
        click(btn(/^Both$/));
        expect(lines()).toHaveLength(2);
    });

    it('levels toggle independently', () => {
        render({ rows: [row(1), row(2, { level: 'error', message: 'bad' }), row(3, { level: 'debug', message: 'dbg' })] });
        expect(lines()).toEqual(['line 1', 'bad']);
        click(btn(/^debug$/));
        expect(lines()).toEqual(['line 1', 'bad', 'dbg']);
        click(btn(/^info$/));
        expect(lines()).toEqual(['bad', 'dbg']);
        expect(btn(/^info$/).getAttribute('aria-pressed')).toBe('false');
    });

    it('search narrows as you type', () => {
        render({ rows: [row(1, { message: 'lamp on' }), row(2, { message: 'fan off' })] });
        type('lamp');
        expect(lines()).toEqual(['lamp on']);
        type('');
        expect(lines()).toHaveLength(2);
    });

    it('filters apply to lines that arrive later too', () => {
        const first = [row(1, { message: 'lamp on' })];
        render({ rows: first });
        type('lamp');
        render({ rows: [...first, row(2, { message: 'fan off' }), row(3, { message: 'lamp off' })] });
        expect(lines()).toEqual(['lamp on', 'lamp off']);
    });
});

describe('LogsPanel: tail, pause, resume', () => {
    it('follows the tail by default and says so', () => {
        render({ rows: many(500) });
        expect(lines()).toContain('line 500');
        expect(host.textContent).toContain('Tailing');
    });

    it('page mode ends the list with a tail row and puts the filters in a card', () => {
        render({ rows: many(5) });
        expect(host.querySelector('.loglist-frame .logs-tail')!.textContent).toBe('waiting for new lines…');
        expect(host.querySelector('.logs-bar.card')).not.toBeNull();
    });

    it('status row shows the buffered count and the title', () => {
        render({ rows: many(1284), title: 'Logs' });
        expect(host.querySelector('.logs-status')!.textContent).toBe('Tailing · 1,284 lines buffered');
        expect(host.querySelector('h1')!.textContent).toBe('Logs');
    });

    it('Download saves the whole buffer (not the filtered view) as NDJSON', async () => {
        let blob: Blob | undefined;
        URL.createObjectURL = ((b: Blob) => { blob = b; return 'blob:x' }) as any;
        URL.revokeObjectURL = () => { };
        const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { });
        render({ rows: many(3) });
        type('line 2');
        click(btn(/Download/));
        expect(clicked).toHaveBeenCalled();
        const out = (await blob!.text()).trim().split('\n').map(l => JSON.parse(l));
        expect(out.map(r => r.id)).toEqual([1, 2, 3]);
    });

    it('Pause holds the view; new lines are counted, not shown', () => {
        const base = many(500);
        render({ rows: base });
        click(btn(/Pause/));
        render({ rows: [...base, row(501, { message: 'fresh' }), row(502, { message: 'fresher' })] });
        expect(lines()).not.toContain('fresh');
        expect(lines()).toContain('line 500');
        expect(host.textContent).toMatch(/Paused/);
        expect(btn(/Resume/).textContent).toContain('2 new');
    });

    it('Resume jumps to the tail and shows what came in', () => {
        const base = many(500);
        render({ rows: base });
        click(btn(/Pause/));
        const more = [...base, row(501, { message: 'fresh' })];
        render({ rows: more });
        click(btn(/Resume/));
        expect(state.paused).toBe(false);
        expect(lines()).toContain('fresh');
        expect(host.textContent).toContain('Tailing');
    });

    it('scrolling up from the tail pauses', () => {
        render({ rows: many(500) });
        const sc = host.querySelector<HTMLElement>('.loglist')!;
        act(() => { sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')) });
        expect(state.paused).toBe(true);
        expect(btn(/Resume/)).toBeTruthy();
    });
});

describe('LogsPanel: jump to error', () => {
    it('is disabled when there is no error', () => {
        render({ rows: many(3) });
        expect(btn(/Latest error/).disabled).toBe(true);
    });

    it('scrolls to the newest error, opens its stack and holds the view', () => {
        const rows = many(2000, i => i === 700 ? { level: 'error', message: 'kaboom', stack: [{ file: 'a.ts', line: 1 }] } : {});
        render({ rows });
        click(btn(/Latest error/));
        expect(lines()).toContain('kaboom');
        expect(host.querySelector('.log-focus')).not.toBeNull();
        expect(host.querySelector('.log-stack')).not.toBeNull();
        expect(state.paused).toBe(true);
    });
});

describe('LogsPanel: scale', () => {
    it('10k+ lines: only a window is in the DOM, filters still apply to all of them', () => {
        const rows = many(12_000, i => i % 100 === 0 ? { level: 'warn', message: `warn ${i}` } : {});
        render({ rows });
        expect(host.querySelectorAll('.log-line').length).toBeLessThan(60);
        click(btn(/^info$/)); click(btn(/^error$/)); click(btn(/^lifecycle$/));
        expect(lines()).toContain('warn 12000');
        expect(host.querySelectorAll('.log-line').length).toBeLessThan(60);
    });
});

describe('LogsPanel: source filter', () => {
    const mixed = [row(1, { message: 'app line' }), row(2, { message: 'plugin line', source: { kind: 'plugin', id: 'ha' } }), row(3, { message: 'sys line', source: { kind: 'system', id: 'hypervisor' } })];
    it('has no source filter unless asked for', () => {
        render({ rows: mixed });
        expect(host.querySelector('[aria-label="source"]')).toBeNull();
    });
    it('toggles source kinds on and off', () => {
        render({ rows: mixed, sourceFilter: true });
        expect(lines()).toEqual(['app line', 'plugin line', 'sys line']);
        const chip = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
        expect(host.querySelector('.fchip:not(.fchip-off)')!.textContent).toBe('source: all apps');
        click(chip('Hide plugins'));
        expect(lines()).toEqual(['app line', 'sys line']);
        click(chip('Hide all apps'));
        expect(lines()).toEqual(['sys line']);
        expect(host.querySelector('.fchip:not(.fchip-off)')!.textContent).toBe('source: system');
        click(chip('Show plugins'));
        expect(lines()).toEqual(['plugin line', 'sys line']);
    });
});

describe('LogsPanel: scoped (one source)', () => {
    it('is one card: toolbar, no source column, tail footer inside, no Latest error, has Download', () => {
        render({ rows: [row(1)], scoped: true });
        const card = host.querySelector('section.logs-card')!;
        expect(card.querySelector('.logs-bar')).not.toBeNull();
        expect(card.querySelector('.logs-foot')!.textContent).toBe('Tailing — new lines appear here');
        expect(card.querySelector('.loglist-frame .logs-foot')).not.toBeNull();
        expect(card.querySelector('.log-line:not(.log-head) .log-src')).toBeNull();
        expect(btn(/Pause tail/)).toBeDefined();
        expect(btn(/Latest error/)).toBeUndefined();
        expect(btn(/Download/)).toBeDefined();
    });

    it('Pause tail holds the view; Resume tail follows again', () => {
        render({ rows: [row(1)], scoped: true });
        click(btn(/Pause tail/));
        expect(host.querySelector('.logs-foot')!.textContent).toMatch(/Paused/);
        click(btn(/Resume tail/));
        expect(host.querySelector('.logs-foot')!.textContent).toMatch(/Tailing/);
    });
});
