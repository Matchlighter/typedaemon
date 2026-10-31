import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Clock } from '../stores/clock';
import { ScheduleRow, type ScheduleRowProps } from './ScheduleRow';

const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();
const clock = new Clock(() => NOW);
const base: ScheduleRowProps = { expression: '*/15 * * * *', kind: 'cron', method: 'sync_presence', nextAt: NOW + 7 * 60_000 + 48_000, lastAt: NOW - 3 * 60_000, lastResult: 'ok', lastDurationMs: 14, clock };
const html = (p: Partial<ScheduleRowProps> = {}) => renderToString(<ScheduleRow {...base} {...p} />);

describe('ScheduleRow', () => {
    it.each([
        ['sunset-0:30', 'sun'],
        ['MON-FRI 6:45 AM', 'cron'],
        ['*/15 * * * *', 'cron'],
        ["run_every('5m')", 'interval'],
        ['2026-10-20 06:00', 'at'],
    ] as const)('renders expression %s exactly as written with kind %s', (expression, kind) => {
        const out = html({ expression, kind });
        expect(out).toContain(`>${expression.replace(/'/g, '&#x27;')}</span>`);
        expect(out).toContain(`>${kind}</span>`);
    });

    it('method, countdown with absolute on hover, last fire, ok badge', () => {
        const out = html();
        expect(out).toContain('sync_presence');
        expect(out).toContain('in 7m 48s');
        expect(out).toContain('12:07:48');
        expect(out).toContain('11:57:00');
        expect(out).toContain('badge-ok');
        expect(out).toContain('ok · 14 ms');
    });

    it('ok without a duration is just "ok"; sub-second/seconds formatting', () => {
        expect(html({ lastDurationMs: undefined })).toMatch(/badge-ok[^>]*>.*ok<\/span>/);
        expect(html({ lastDurationMs: 1234 })).toContain('ok · 1.2 s');
    });

    it('error result shows "error"', () => {
        const out = html({ lastResult: 'error' });
        expect(out).toContain('badge-err');
        expect(out).toContain('error</span>');
        expect(out).not.toContain('ok ·');
    });

    it('never-fired / no next fire show placeholders', () => {
        const out = html({ nextAt: undefined, lastAt: undefined, lastResult: undefined });
        expect(out).not.toContain('<time');
        expect(out).not.toContain('badge');
        expect(out.match(/—/g)?.length).toBe(2);
    });
});

describe('schedule.css', () => {
    const css = readFileSync(new URL('../styles/schedule.css', import.meta.url), 'utf8');
    it('stacks at phone width', () => expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.sched-row/));
});
