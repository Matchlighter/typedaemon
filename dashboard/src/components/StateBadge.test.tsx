import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StateBadge, badgeSpec, type BadgeState } from './StateBadge';

const html = (s: BadgeState) => renderToString(<StateBadge {...s} />);

describe('StateBadge', () => {
    it('animated blue for transition app states', () => {
        for (const state of ['initializing', 'compiling', 'starting'] as const) {
            const out = html({ kind: 'app', state });
            expect(out).toContain('badge-run');
            expect(out).toContain('badge-spin');
            expect(out).toContain(state);
        }
    });

    it('started is green with an icon and text', () => {
        const out = html({ kind: 'app', state: 'started' });
        expect(out).toContain('badge-ok');
        expect(out).toContain('<svg');
        expect(out).toContain('started');
        expect(out).not.toContain('badge-spin');
    });

    it('stopping/stopped grey, dead red, orphan amber', () => {
        expect(html({ kind: 'app', state: 'stopping' })).toContain('badge-off');
        expect(html({ kind: 'app', state: 'stopped' })).toContain('badge-off');
        expect(html({ kind: 'app', state: 'dead' })).toContain('badge-err');
        expect(html({ kind: 'app', state: 'orphan' })).toContain('badge-warn');
    });

    it('stopped override has ring and tooltip', () => {
        const out = html({ kind: 'app', state: 'stopped', override: true });
        expect(out).toContain('stopped · override');
        expect(out).toContain('badge-ring');
        expect(out).toContain('Stopped from the dashboard — resets on next config reload');
    });

    it('linked is text-only ok; unlinked is amber outline', () => {
        const linked = html({ kind: 'entity', state: 'linked' });
        expect(linked).toContain('badge-ok');
        expect(linked).not.toContain('<svg');
        const unlinked = html({ kind: 'entity', state: 'unlinked' });
        expect(unlinked).toContain('badge-outline-warn');
        expect(unlinked).toContain('unlinked');
        expect(unlinked).not.toContain('<svg');
    });

    it('resumable, call, plugin states', () => {
        expect(badgeSpec({ kind: 'resumable', state: 'running' }).tone).toBe('run');
        expect(badgeSpec({ kind: 'resumable', state: 'suspended' }).tone).toBe('off');
        expect(badgeSpec({ kind: 'resumable', state: 'failed' })).toMatchObject({ tone: 'err', label: 'failed to resume' });
        expect(badgeSpec({ kind: 'call', state: 'pending' }).tone).toBe('off');
        expect(badgeSpec({ kind: 'plugin', state: 'connected' }).tone).toBe('ok');
        expect(badgeSpec({ kind: 'plugin', state: 'reconnecting' })).toMatchObject({ tone: 'run', animated: true });
        expect(badgeSpec({ kind: 'plugin', state: 'disconnected' }).tone).toBe('err');
        expect(badgeSpec({ kind: 'plugin', state: 'listening' }).tone).toBe('ok');
    });

    it('mock icon set: text-only for resumable/call/connected; square, bang, outline warn', () => {
        for (const s of [{ kind: 'resumable', state: 'running' }, { kind: 'resumable', state: 'suspended' }, { kind: 'call', state: 'pending' }, { kind: 'plugin', state: 'connected' }] as const)
            expect(badgeSpec(s).icon).toBe('none');
        expect(badgeSpec({ kind: 'app', state: 'stopped' }).icon).toBe('square');
        expect(badgeSpec({ kind: 'resumable', state: 'failed' }).icon).toBe('bang');
        expect(badgeSpec({ kind: 'app', state: 'orphan' }).icon).toBe('warn');
    });

    it('every state has text label (never color alone)', () => {
        for (const s of ALL) expect(badgeSpec(s).label.length).toBeGreaterThan(0);
    });

    it('label override and tooltip passthrough', () => {
        const out = html({ kind: 'result', state: 'error', label: 'last: error' });
        expect(out).toContain('last: error');
        expect(out).toContain('badge-err');
    });
});

const ALL: BadgeState[] = [
    ...(['initializing', 'compiling', 'starting', 'started', 'stopping', 'stopped', 'dead', 'orphan'] as const).map(state => ({ kind: 'app', state }) as const),
    { kind: 'entity', state: 'linked' }, { kind: 'entity', state: 'unlinked' },
    ...(['running', 'suspended', 'failed'] as const).map(state => ({ kind: 'resumable', state }) as const),
    { kind: 'call', state: 'pending' },
    ...(['connected', 'reconnecting', 'disconnected', 'listening'] as const).map(state => ({ kind: 'plugin', state }) as const),
    { kind: 'result', state: 'ok' }, { kind: 'result', state: 'error' },
];

// Independent AA check: parse token hex values straight from tokens.css.
function tokens(block: string) {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/--(\w+):\s*(#[0-9a-fA-F]{3,6})/g)) out[m[1]] = m[2];
    return out;
}
const lum = (hex: string) => {
    const h = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('badge contrast (AA 4.5:1)', () => {
    const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
    const [light, dark] = css.split(':root[data-theme="dark"]');
    const css2 = readFileSync(new URL('../styles/badge.css', import.meta.url), 'utf8');
    const pairs = [...css2.matchAll(/\.badge-(\w+)\s*\{[^}]*?color:\s*var\(--(\w+)\)[^}]*?background:\s*var\(--(\w+)\)/g)];
    it('badge.css defines tone pairs', () => expect(pairs.length).toBeGreaterThanOrEqual(5));
    for (const [name, t] of [['light', light], ['dark', dark]] as const) {
        const tk = { ...tokens(light), ...tokens(t) };
        it(`${name}: all tone pairs pass`, () => {
            for (const [, tone, fg, bg] of pairs) expect(ratio(tk[fg], tk[bg]), `${tone} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
        });
        it(`${name}: outline warn text on card passes`, () => expect(ratio(tk.warnf, tk.card)).toBeGreaterThanOrEqual(4.5));
    }
});
