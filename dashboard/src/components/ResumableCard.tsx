import type { ReactNode } from 'react';
import { plural } from '../format';
import '../styles/resumable.css';
import { sharedClock, type Clock } from '../stores/clock';
import { Chip } from './Chip';
import { absoluteShort, RelativeTime } from './RelativeTime';
import { StateBadge } from './StateBadge';

export type ResumableWait =
    | { kind: 'sleep'; until: number }
    | { kind: 'condition'; condition: string; since: number };

export interface ResumableCardProps {
    status: 'running' | 'suspended' | 'failed';
    /** `@resumable` method call vs `@script({shutdown:'suspend'})` run. */
    type: 'resumable' | 'script';
    owner: string;
    method: string;
    params: unknown[];
    /** What it is blocked on; omit when not waiting. */
    wait?: ResumableWait;
    startedAt: number;
    /** App restarts survived. */
    restarts?: number;
    /** Required for (and only shown with) `status: 'failed'`. */
    failure?: { error: string; attempts: number };
    /** Trailing slot: Cancel… (running/suspended) or Discard… (failed). */
    action?: ReactNode;
    /** Defaults to the shared app clock */
    clock?: Clock;
}

const formatCall = (p: ResumableCardProps) => `${p.owner}:${p.method}([${p.params.map(a => JSON.stringify(a)).join(', ')}])`;

/** "06:30" for today, otherwise the compact date form ("Tomorrow 07:05", "Mon 06:33", ...). */
function untilLabel(at: number, now: number) {
    const a = new Date(at);
    if (a.toDateString() !== new Date(now).toDateString()) return absoluteShort(at, now);
    return `${String(a.getHours()).padStart(2, '0')}:${String(a.getMinutes()).padStart(2, '0')}`;
}

function WaitLine(p: ResumableCardProps) {
    const clock = p.clock ?? sharedClock;
    const { wait } = p;
    return (
        <div className="resumable-wait">
            {wait?.kind === 'sleep' && <>
                <b>Sleeping until {untilLabel(wait.until, clock.now)}</b> (<RelativeTime at={wait.until} clock={p.clock} />)
                {' · '}
            </>}
            {wait?.kind === 'condition' && <>
                <b>Waiting for</b> <span className="mono">{wait.condition}</span> · <RelativeTime at={wait.since} mode="age" clock={p.clock} />
            </>}
            {wait?.kind !== 'condition' && <>started <RelativeTime at={p.startedAt} clock={p.clock} /></>}
            {!!p.restarts && ` · survived ${plural(p.restarts, 'restart')}`}
        </div>
    );
}

/** Resumable / suspend-script card (design.md "Resumable card"). */
export function ResumableCard(p: ResumableCardProps) {
    const failed = p.status === 'failed' ? p.failure : undefined;
    return (
        <div className={`resumable-card${failed ? ' resumable-card-failed' : ''}`}>
            <div className="resumable-head">
                <StateBadge kind="resumable" state={p.status} />
                <Chip mono>{p.type === 'script' ? '@script suspend' : '@resumable'}</Chip>
                {failed && <span className="resumable-attempts">{plural(failed.attempts, 'attempt')}</span>}
            </div>
            <div className="mono resumable-call" title={formatCall(p)}>{formatCall(p)}</div>
            {failed ? (
                <>
                    <div className="mono resumable-error">{failed.error}</div>
                    <div className="resumable-wait">Retried on every start until fixed or discarded.</div>
                </>
            ) : <WaitLine {...p} />}
            {p.action && <div className="resumable-action">{p.action}</div>}
        </div>
    );
}
