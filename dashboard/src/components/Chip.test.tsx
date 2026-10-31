import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
    it('renders children in a .chip span', () => {
        expect(renderToString(<Chip>internal</Chip>)).toBe('<span class="chip">internal</span>');
    });
    it('mono and accent modifiers, extra className, passthrough attrs', () => {
        const out = renderToString(<Chip mono accent className="x" role="status">changed</Chip>);
        expect(out).toContain('class="chip chip-mono chip-accent x"');
        expect(out).toContain('role="status"');
    });
});

describe('chip styles', () => {
    it('live in shared app.css, not per-component sheets', () => {
        const read = (f: string) => readFileSync(new URL(`../styles/${f}`, import.meta.url), 'utf8');
        expect(read('app.css')).toMatch(/\.chip\s*\{/);
        for (const f of ['entity.css', 'storage.css', 'schedule.css']) expect(read(f)).not.toMatch(/chip|sched-kind/);
    });
});
