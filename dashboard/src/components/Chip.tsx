import type { HTMLAttributes } from 'react';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
    /** Monospace face, for code-ish values (flags, kinds). */
    mono?: boolean;
    /** Highlighted (live-change) tint. */
    accent?: boolean;
    /** Semantic tint (design tokens ok / run). */
    tone?: 'ok' | 'run';
}

/** Small pill tag. Styles in app.css (`.chip`, `.chip-mono`, `.chip-accent`). */
export function Chip({ mono, accent, tone, className, ...rest }: ChipProps) {
    const cls = ['chip', mono && 'chip-mono', accent && 'chip-accent', tone && `chip-${tone}`, className].filter(Boolean).join(' ');
    return <span {...rest} className={cls} />;
}
