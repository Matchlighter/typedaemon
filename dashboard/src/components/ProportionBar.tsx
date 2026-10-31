import '../styles/proportion_bar.css';

export interface BarSegment {
    count: number;
    /** State color family: `ok` green, `run` blue, `err` red, `off` grey */
    tone: 'ok' | 'run' | 'err' | 'off';
}

/** Thin stacked bar, each segment sized by its count. Decorative: put the numbers in text next to it. */
export function ProportionBar({ segments }: { segments: BarSegment[] }) {
    return (
        <span className="pbar" aria-hidden="true">
            {segments.filter(s => s.count > 0).map(s => <span key={s.tone} className={`pbar-${s.tone}`} style={{ flex: s.count }} />)}
        </span>
    );
}
