import type { LogLevel, LogRow } from '@protocol';
import { makeAutoObservable, observable } from 'mobx';
import { ALL_KINDS, DEFAULT_LEVELS, filterLogs, lastError, type ChannelFilter, type LogSourceKind } from './logs_model';

/**
 * What the user chose to see in a log view: filters, search, pause, open stacks, the line to scroll to.
 * Keyed by view (`logsViewState`), not by data, so it survives restarts, resubscribes and switching tabs.
 */
export class LogsViewState {
    channel: ChannelFilter = 'both';
    levels: readonly LogLevel[] = DEFAULT_LEVELS;
    search = '';
    kinds: readonly LogSourceKind[] = ALL_KINDS;
    paused = false;
    /** Newest line id the paused view shows */
    private pausedAt = 0;
    /** Line the list should scroll to */
    focusId: number | undefined = undefined;
    /** Stacks the user closed: they are open by default */
    private collapsed = observable.set<number>();

    constructor(initial: Partial<Pick<LogsViewState, 'channel' | 'levels'>> = {}) {
        Object.assign(this, initial);
         makeAutoObservable<LogsViewState, 'pausedAt'>(this, { pausedAt: false }); }

    private get filters() { return { channel: this.channel, levels: this.levels, search: this.search, kinds: this.kinds }; }

    setChannel(c: ChannelFilter) { this.channel = c; }
    setLevels(l: readonly LogLevel[]) { this.levels = l; }
    setSearch(s: string) { this.search = s; }
    setKinds(k: readonly LogSourceKind[]) { this.kinds = k; }

    /** Lines to list: filtered, and frozen at the pause point while paused */
    visible(rows: readonly LogRow[]): LogRow[] {
        return filterLogs(this.paused ? rows.filter(r => r.id <= this.pausedAt) : rows, this.filters);
    }

    /** Matching lines that arrived since pausing */
    pendingCount(rows: readonly LogRow[]): number {
        return this.paused ? filterLogs(rows.filter(r => r.id > this.pausedAt), this.filters).length : 0;
    }

    pause(rows: readonly LogRow[]) {
        this.pausedAt = rows.length ? rows[rows.length - 1].id : 0;
        this.paused = true;
    }

    resume() { this.paused = false; this.focusId = undefined; }

    isExpanded(id: number) { return !this.collapsed.has(id); }
    setExpanded(id: number, open: boolean) { if (open) this.collapsed.delete(id); else this.collapsed.add(id); }

    /** Scroll to the newest error (undoing whatever filter hides it), open its stack, hold the view. False if there is none */
    jumpToLastError(rows: readonly LogRow[]): boolean {
        return this.jumpTo(rows, lastError(rows));
    }

    /** `jumpToLastError` for the line with this id (eg the one a failure was reported by). False if it is not in `rows` (any more) */
    jumpToLog(rows: readonly LogRow[], id: number): boolean {
        return this.jumpTo(rows, rows.find(r => r.id === id));
    }

    private jumpTo(rows: readonly LogRow[], err: LogRow | undefined): boolean {
        if (!err) return false;
        if (!this.levels.includes(err.level)) this.levels = [...this.levels, err.level];
        if (!this.kinds.includes(err.source.kind)) this.kinds = [...this.kinds, err.source.kind];
        if (this.channel !== 'both' && this.channel !== err.channel) this.channel = 'both';
        if (filterLogs([err], this.filters).length === 0) this.search = '';
        this.pausedAt = rows[rows.length - 1].id;
        this.paused = true;
        this.collapsed.delete(err.id);
        this.focusId = err.id;
        return true;
    }
}

const states = new Map<string, LogsViewState>();
/** The view state for `key` (e.g. `app:lights`), created on first use (with `initial` filters) */
export function logsViewState(key: string, initial?: ConstructorParameters<typeof LogsViewState>[0]): LogsViewState {
    let s = states.get(key);
    if (!s) states.set(key, s = new LogsViewState(initial));
    return s;
}
