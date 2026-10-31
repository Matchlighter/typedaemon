import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Clock } from '../stores/clock';
import { ResumableCard, type ResumableCardProps } from './ResumableCard';

const H = 3_600_000, M = 60_000;
const NOW = new Date(2026, 9, 19, 14, 0, 0).getTime();
const clock = new Clock(() => NOW);
const base: ResumableCardProps = {
    status: 'suspended', type: 'resumable', owner: 'hvac', method: 'preheat_then_cool', params: ['bedroom', 21],
    wait: { kind: 'sleep', until: NOW + 16 * H + 23 * M }, startedAt: NOW - 9 * H, restarts: 1, clock,
};
const html = (p: Partial<ResumableCardProps> = {}) => renderToString(<ResumableCard {...base} {...p} />);

describe('ResumableCard', () => {
    it('shows owner:method(params) in mono with params as a list', () => {
        const out = html();
        expect(out).toContain('hvac:preheat_then_cool([&quot;bedroom&quot;, 21])');
        expect(out).toMatch(/class="mono[^"]*"[^>]*>hvac:/);
    });

    it('status badge and type chip', () => {
        expect(html()).toContain('badge-off');
        expect(html()).toContain('>@resumable</span>');
        const out = html({ status: 'running', type: 'script' });
        expect(out).toContain('badge-run');
        expect(out).toContain('>@script suspend</span>');
    });

    it('sleep wait line: until, countdown, started, restarts survived', () => {
        const out = html();
        expect(out).toContain('Sleeping until');
        expect(out).toContain('Tomorrow 06:23');
        expect(out).toContain('in 16h 23m');
        expect(out).toContain('started');
        expect(out).toContain('9h ago');
        expect(out).toContain('survived 1 restart');
    });

    it('pluralises restarts, omits when zero', () => {
        expect(html({ restarts: 3 })).toContain('survived 3 restarts');
        expect(html({ restarts: 0 })).not.toContain('survived');
    });

    it('condition wait line: mono condition and since', () => {
        const out = html({ status: 'running', wait: { kind: 'condition', condition: 'sensor.door == "closed"', since: NOW - 3 * H } });
        expect(out).toContain('Waiting for');
        expect(out).toMatch(/class="mono"[^>]*>sensor\.door == &quot;closed&quot;</);
        expect(out).toContain('3h 0m');
    });

    it('no wait line content when nothing to wait on', () => {
        expect(html({ wait: undefined })).not.toMatch(/Sleeping|Waiting/);
    });

    it('failed variant: error, attempts, retry notice, error styling', () => {
        const out = html({ status: 'failed', failure: { error: 'Error: no method preheat_then_cool', attempts: 3 } });
        expect(out).toContain('badge-err');
        expect(out).toContain('resumable-card-failed');
        expect(out).toContain('Error: no method preheat_then_cool');
        expect(out).toContain('3 attempts');
        expect(out).toContain('Retried on every start until fixed or discarded.');
    });

    it('singular attempt; non-failed shows no failure bits', () => {
        expect(html({ status: 'failed', failure: { error: 'x', attempts: 1 } })).toContain('1 attempt<');
        const out = html();
        expect(out).not.toContain('Retried on every start');
        expect(out).not.toContain('resumable-card-failed');
    });

    it('action slot renders on the right', () => {
        expect(html({ action: <button className="btn btn-sm btn-danger-outline">Cancel…</button> })).toContain('Cancel…');
    });
});

describe('resumable.css', () => {
    const css = readFileSync(new URL('../styles/resumable.css', import.meta.url), 'utf8');
    it('failed border uses error token; stacks at phone width', () => {
        expect(css).toMatch(/\.resumable-card-failed[^{]*\{[^}]*--errf/);
        expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.resumable-card/);
    });
});
