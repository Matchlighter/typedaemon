// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogLine, formatLogTime, type LogEntry, type LogLevel } from './LogLine';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (ui: React.ReactElement) => act(() => root.render(ui));
const at = new Date(2026, 9, 19, 14, 6, 41, 7).getTime(); // local time
const entry = (extra: Partial<LogEntry> = {}): LogEntry => ({ ts: at, level: 'info', source: 'lights', message: 'hello', ...extra });
const withStack = entry({
    level: 'error', message: 'boom',
    stack: [
        { fn: 'Lights.run', file: 'apps/lights/index.ts', line: 42, col: 17, href: 'vscode://file/apps/lights/index.ts:42:17' },
        { fn: 'plain', file: 'apps/lights/util.ts', line: 3 },
    ],
});
const toggle = () => host.querySelector<HTMLButtonElement>('button.log-stack-toggle')!;

describe('LogLine', () => {
    it('formats ms timestamps as HH:MM:SS.mmm', () => {
        expect(formatLogTime(at)).toBe('14:06:41.007');
    });

    it('renders ts, level, source and message', () => {
        render(<LogLine entry={entry()} />);
        const row = host.querySelector('.log-line')!;
        expect(row.querySelector('.log-ts')!.textContent).toBe('14:06:41.007');
        expect(row.querySelector('.log-level')!.textContent).toBe('info');
        expect(row.querySelector('.log-src')!.textContent).toBe('lights');
        expect(row.querySelector('.log-msg')!.textContent).toBe('hello');
    });

    it('tooltips the time with the full date and lets the message wrap', () => {
        render(<LogLine entry={entry()} />);
        expect(host.querySelector('.log-ts')!.getAttribute('title')).toBe('2026-10-19 14:06:41.007');
        expect(host.querySelector('.log-msg')!.hasAttribute('title')).toBe(false);
    });

    it('styles every level distinctly and keeps the text label', () => {
        const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'lifecycle'];
        for (const level of levels) {
            render(<LogLine entry={entry({ level })} />);
            const row = host.querySelector('.log-line')!;
            expect(row.classList.contains(`log-${level}`)).toBe(true);
            expect(row.querySelector('.log-level')!.textContent).toBe(level);
        }
    });

    it('has no stack toggle without a stack', () => {
        render(<LogLine entry={entry({ level: 'error' })} />);
        expect(toggle()).toBeNull();
    });

    it('open by default: "Stack trace · source-mapped" summary, frames listed', () => {
        render(<LogLine entry={withStack} />);
        expect(toggle().textContent).toBe('▾ Stack trace · source-mapped');
        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(host.querySelectorAll('.log-frame')).toHaveLength(2);
    });

    it('frames have file:line links; click collapses', () => {
        render(<LogLine entry={withStack} />);
        const frames = host.querySelectorAll('.log-frame');
        expect(frames).toHaveLength(2);
        const link = frames[0].querySelector('a')!;
        expect(link.textContent).toBe('apps/lights/index.ts:42:17');
        expect(link.getAttribute('href')).toBe('vscode://file/apps/lights/index.ts:42:17');
        expect(frames[0].textContent).toContain('at Lights.run');
        // frame without href: text, not a dead link
        expect(frames[1].querySelector('a')).toBeNull();
        expect(frames[1].textContent).toContain('apps/lights/util.ts:3');
        act(() => toggle().click());
        expect(host.querySelector('.log-stack')).toBeNull();
        expect(toggle().textContent).toBe('▸ Stack trace · source-mapped');
    });

    it('folds framework frames into a count', () => {
        render(<LogLine entry={entry({ stack: [
            { file: 'apps/a.ts', line: 1 }, { file: 'node_modules/x/y.js', line: 2 }, { file: 'node:internal/z', line: 3 },
        ] })} />);
        expect(host.querySelectorAll('.log-frame')).toHaveLength(2);
        expect(host.querySelector('.log-frame-fold')!.textContent).toBe('… 2 framework frames');
    });

    it('shows "jump to cause" only with a causeId and handler', () => {
        const onJump = vi.fn();
        render(<LogLine entry={entry({ level: 'lifecycle', causeId: 7 })} onJumpToCause={onJump} />);
        act(() => host.querySelector<HTMLButtonElement>('.log-jump')!.click());
        expect(onJump).toHaveBeenCalledWith(7);
        render(<LogLine entry={entry({ level: 'lifecycle' })} onJumpToCause={onJump} />);
        expect(host.querySelector('.log-jump')).toBeNull();
    });

    it('toggle is a real button wired to the stack region (keyboard operable)', () => {
        render(<LogLine entry={withStack} />);
        expect(toggle().tagName).toBe('BUTTON');
        expect(toggle().type).toBe('button');
        const id = toggle().getAttribute('aria-controls')!;
        expect(host.querySelector(`#${CSS.escape(id)}`)).toBe(host.querySelector('.log-stack'));
    });

    it('controlled: expanded prop wins and onToggle reports intent', () => {
        const onToggle = vi.fn();
        render(<LogLine entry={withStack} expanded={false} onToggle={onToggle} />);
        act(() => toggle().click());
        expect(onToggle).toHaveBeenCalledWith(true);
        expect(host.querySelector('.log-stack')).toBeNull();
        render(<LogLine entry={withStack} expanded onToggle={onToggle} />);
        expect(host.querySelector('.log-stack')).not.toBeNull();
        act(() => toggle().click());
        expect(onToggle).toHaveBeenLastCalledWith(false);
    });

    it('survives virtual-list remount when parent keeps expanded state', () => {
        render(<LogLine entry={withStack} expanded onToggle={() => {}} />);
        act(() => root.render(null));
        render(<LogLine entry={withStack} expanded onToggle={() => {}} />);
        expect(host.querySelectorAll('.log-frame')).toHaveLength(2);
    });
});
