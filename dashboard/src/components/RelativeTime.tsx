import { mount_effect, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { Clock, sharedClock } from '../stores/clock';
import '../styles/reltime.css';

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

/** "3 min ago", "in 7m 48s", "in 2h 14m". */
export function formatRelative(at: number, now: number): string {
    const diff = at - now;
    const abs = Math.abs(diff);
    if (diff > 0 && abs < S) return 'just now'; // sub-second future (clock skew: "in 0s")
    if (diff > 0) {
        if (abs < M) return `in ${Math.floor(abs / S)}s`;
        if (abs < H) return `in ${Math.floor(abs / M)}m ${Math.floor((abs % M) / S)}s`;
        if (abs < D) return `in ${Math.floor(abs / H)}h ${Math.floor((abs % H) / M)}m`;
        return `in ${Math.floor(abs / D)}d ${Math.floor((abs % D) / H)}h`;
    }
    if (abs < 5 * S) return 'just now';
    if (abs < M) return `${Math.floor(abs / S)}s ago`;
    if (abs < H) return `${Math.floor(abs / M)} min ago`;
    if (abs < D) return `${Math.floor(abs / H)}h ago`;
    return `${Math.floor(abs / D)}d ago`;
}

/** Compact elapsed time for lists: "just now", "9 min", "4h 55m", "3d 4h" */
export function formatAge(ms: number): string {
    const a = Math.max(0, ms);
    if (a < 5 * S) return 'just now';
    if (a < M) return `${Math.floor(a / S)}s`;
    if (a < H) return `${Math.floor(a / M)} min`;
    if (a < D) return `${Math.floor(a / H)}h ${Math.floor((a % H) / M)}m`;
    return `${Math.floor(a / D)}d ${Math.floor((a % D) / H)}h`;
}

const p = (n: number) => String(n).padStart(2, '0');

/** "Today 18:00" for the same local day as `now`, otherwise "2026-10-18 14:06:41". */
export function absoluteTime(at: number, now: number): string {
    const a = new Date(at), n = new Date(now);
    const time = `${p(a.getHours())}:${p(a.getMinutes())}`;
    if (a.toDateString() === n.toDateString()) return `Today ${time}`;
    return `${a.getFullYear()}-${p(a.getMonth() + 1)}-${p(a.getDate())} ${time}:${p(a.getSeconds())}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Compact absolute time for tables: "14:10:00" within the hour, else "Today 18:00", "Yesterday 18:01", "Mon 06:33"
 * (within a week), otherwise "2026-10-18 14:06".
 */
export function absoluteShort(at: number, now: number): string {
    const a = new Date(at), n = new Date(now);
    const hm = `${p(a.getHours())}:${p(a.getMinutes())}`;
    if (Math.abs(at - now) < H && a.toDateString() === n.toDateString()) return `${hm}:${p(a.getSeconds())}`;
    const dayDiff = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / D);
    if (dayDiff === 0) return `Today ${hm}`;
    if (dayDiff === -1) return `Yesterday ${hm}`;
    if (dayDiff === 1) return `Tomorrow ${hm}`;
    if (Math.abs(dayDiff) < 7) return `${DAYS[a.getDay()]} ${hm}`;
    return `${a.getFullYear()}-${p(a.getMonth() + 1)}-${p(a.getDate())} ${hm}`;
}

/** "14 ms", "1.2 s", "2m 5s" */
export function formatDuration(ms: number): string {
    if (ms < S) return `${Math.round(ms)} ms`;
    if (ms < M) return `${(ms / S).toFixed(1)} s`;
    return `${Math.floor(ms / M)}m ${Math.floor((ms % M) / S)}s`;
}

export interface RelativeTimeProps {
    /** Epoch ms (or Date) */
    at: number | Date;
    /** Defaults to the shared app clock */
    clock?: Clock;
    /** `relative` (default; absolute on hover), `absolute` (compact absolute only), `both` (relative emphasised, absolute muted) or `age` (time since `at`, compact: "4h 55m"; absolute on hover) */
    mode?: 'relative' | 'absolute' | 'both' | 'age';
}

/** Relative time that ticks from the shared clock; absolute time on hover/keyboard focus. Dims while the clock is paused (stale). */
@with_meta_components
@observer
export class RelativeTime extends Component<RelativeTimeProps> {
    private get clock() { return this.props.clock ?? sharedClock; }

    /** Keep the shared clock ticking while mounted (returned fn is the effect cleanup). */
    @mount_effect
    retainClock() { return this.clock.retain(); }

    render() {
        const { clock } = this;
        const at = +this.props.at;
        const rel = formatRelative(at, clock.now);
        const abs = absoluteTime(at, clock.now);
        const { mode = 'relative' } = this.props;
        if (mode === 'age') {
            return (
                <time className={clock.paused ? 'reltime reltime-stale' : 'reltime'} dateTime={new Date(at).toISOString()}
                    tabIndex={0} data-abs={abs} aria-label={`${rel} (${abs})`}>
                    {formatAge(clock.now - at)}
                </time>
            );
        }
        if (mode !== 'relative') {
            const short = absoluteShort(at, clock.now);
            return (
                <time className={clock.paused ? 'reltime reltime-plain reltime-stale' : 'reltime reltime-plain'} dateTime={new Date(at).toISOString()}
                    title={abs} aria-label={`${rel} (${abs})`}>
                    {mode === 'both' ? <><span className="reltime-rel">{rel}</span> <span className="reltime-abs">· {short}</span></> : short}
                </time>
            );
        }
        return (
            <time className={clock.paused ? 'reltime reltime-stale' : 'reltime'} dateTime={new Date(at).toISOString()}
                tabIndex={0} data-abs={abs} aria-label={`${rel} (${abs})`}>
                {rel}
            </time>
        );
    }
}
