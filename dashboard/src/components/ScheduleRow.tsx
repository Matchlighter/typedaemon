import '../styles/schedule.css';
import { Chip } from './Chip';
import type { Clock } from '../stores/clock';
import { formatDuration, RelativeTime } from './RelativeTime';
import { StateBadge } from './StateBadge';

export type ScheduleKind = 'sun' | 'cron' | 'interval' | 'at';

export interface ScheduleRowProps {
    /** Exactly as written in the app (e.g. `sunset-0:30`, `MON-FRI 6:45 AM`, `run_every('5m')`). */
    expression: string;
    kind: ScheduleKind;
    /** Callback method name. */
    method: string;
    /** Epoch ms; omit when nothing is pending. */
    nextAt?: number;
    lastAt?: number;
    lastResult?: 'ok' | 'error';
    /** How long the last run took (ms) */
    lastDurationMs?: number;
    /** Defaults to the shared app clock */
    clock?: Clock;
}

const None = () => <span className="sched-none">—</span>;

/** Column header row; shares the grid template of `ScheduleRow` */
export function ScheduleHead() {
    return (
        <div className="sched-row sched-head" aria-hidden="true">
            <span>Expression</span><span>Method</span><span>Next fire</span><span>Last fire</span><span>Result</span>
        </div>
    );
}

/** Schedule row (design.md "Schedule row"). Single row on desktop, stacks at phone width. */
export function ScheduleRow(p: ScheduleRowProps) {
    const resultLabel = p.lastResult === 'error' ? 'error' : p.lastDurationMs != null ? `ok · ${formatDuration(p.lastDurationMs)}` : undefined;
    return (
        <div className="sched-row">
            <span className="sched-expr-cell">
                <span className="mono sched-expr" title={p.expression}>{p.expression}</span>
                <Chip mono>{p.kind}</Chip>
            </span>
            <span className="mono sched-method" title={p.method}>{p.method}</span>
            <span className="sched-next">{p.nextAt != null ? <RelativeTime at={p.nextAt} clock={p.clock} mode="both" /> : <None />}</span>
            <span className="sched-last">{p.lastAt != null ? <RelativeTime at={p.lastAt} clock={p.clock} mode="absolute" /> : <None />}</span>
            <span className="sched-result">
                {p.lastResult && <StateBadge kind="result" state={p.lastResult} label={resultLabel} />}
            </span>
        </div>
    );
}
