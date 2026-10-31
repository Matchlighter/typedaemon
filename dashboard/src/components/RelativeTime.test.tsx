import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Clock } from '../stores/clock';
import { RelativeTime, absoluteTime, formatAge, formatRelative } from './RelativeTime';

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const NOW = new Date(2026, 9, 19, 18, 0, 0).getTime();

describe('formatRelative', () => {
    it('past', () => {
        expect(formatRelative(NOW - 2 * S, NOW)).toBe('just now');
        expect(formatRelative(NOW + 400, NOW)).toBe('just now');
        expect(formatRelative(NOW - 30 * S, NOW)).toBe('30s ago');
        expect(formatRelative(NOW - 3 * M, NOW)).toBe('3 min ago');
        expect(formatRelative(NOW - (3 * H + 20 * M), NOW)).toBe('3h ago');
        expect(formatRelative(NOW - 2 * D - H, NOW)).toBe('2d ago');
    });
    it('future', () => {
        expect(formatRelative(NOW + 45 * S, NOW)).toBe('in 45s');
        expect(formatRelative(NOW + 7 * M + 48 * S, NOW)).toBe('in 7m 48s');
        expect(formatRelative(NOW + 2 * H + 14 * M + 5 * S, NOW)).toBe('in 2h 14m');
        expect(formatRelative(NOW + 3 * D + 4 * H, NOW)).toBe('in 3d 4h');
    });
});

describe('absoluteTime', () => {
    it('Today HH:MM for same local day, ISO-ish otherwise', () => {
        expect(absoluteTime(new Date(2026, 9, 19, 9, 5, 0).getTime(), NOW)).toBe('Today 09:05');
        expect(absoluteTime(new Date(2026, 9, 18, 14, 6, 41).getTime(), NOW)).toBe('2026-10-18 14:06:41');
    });
});

describe('RelativeTime', () => {
    const clock = new Clock(() => NOW);
    it('renders relative text, absolute on hover/focus, keyboard-focusable', () => {
        const out = renderToString(<RelativeTime at={NOW - 3 * M} clock={clock} />);
        expect(out).toContain('3 min ago');
        expect(out).toContain('<time');
        expect(out).toContain('tabindex="0"');
        expect(out).toContain('data-abs="Today 17:57"');
    });
    it('dims when the clock is paused (stale)', () => {
        const c = new Clock(() => NOW);
        expect(renderToString(<RelativeTime at={NOW} clock={c} />)).not.toContain('reltime-stale');
        c.setPaused(true);
        expect(renderToString(<RelativeTime at={NOW} clock={c} />)).toContain('reltime-stale');
    });
});

describe('formatAge', () => {
    it('is compact, without ago', () => {
        expect([0, 30 * S, 9 * M, 4 * H + 55 * M, 3 * D + 4 * H].map(formatAge)).toEqual(['just now', '30s', '9 min', '4h 55m', '3d 4h']);
    });
});
