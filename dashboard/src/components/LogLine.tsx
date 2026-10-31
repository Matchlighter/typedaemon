import { observer } from 'mobx-react';
import { Component } from 'react';
import '../styles/logline.css';
import { with_meta_components } from '@matchlighter/meta_components';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'lifecycle';

export interface StackFrame {
    fn?: string;
    /** Source-mapped path */
    file: string;
    line: number;
    col?: number;
    /** Makes `file:line` a link (e.g. editor deep link). Omitted -> plain text. */
    href?: string;
}

export interface LogEntry {
    /** Epoch ms */
    ts: number;
    level: LogLevel;
    source: string;
    message: string;
    stack?: StackFrame[];
    /** Id of the line that caused this one (eg the error before a "dead" lifecycle line); see `onJumpToCause` */
    causeId?: number;
}

export interface LogLineProps {
    entry: LogEntry;
    /** Controlled expansion. Virtual lists unmount rows on scroll: keep this in the owner (keyed by entry id) to survive that. */
    expanded?: boolean;
    onToggle?: (expanded: boolean) => void;
    /** Leave out the source column (a list already scoped to one source) */
    hideSource?: boolean;
    /** Shows a "jump to cause" link when `entry.causeId` is set */
    onJumpToCause?: (causeId: number) => void;
}

/** Runtime/library frames that are noise when reading a stack: shown as a count, not listed */
export const isFrameworkFrame = (f: StackFrame) => /(^|\/)node_modules\//.test(f.file) || f.file.startsWith('node:');

const p = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local `HH:MM:SS.mmm`. */
export function formatLogTime(ts: number): string {
    const d = new Date(ts);
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Local `YYYY-MM-DD HH:MM:SS.mmm` (tooltip on the time). */
export function formatLogDateTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${formatLogTime(ts)}`;
}

const frameLoc = (f: StackFrame) => `${f.file}:${f.line}${f.col != null ? `:${f.col}` : ''}`;

let nextId = 0;

/**
 * One log line (design.md "Log line"). Long messages wrap, so rows vary in height: a
 * TanStack Virtual list must measure them (`measureElement`) and uses a single-line estimate.
 */
@with_meta_components
@observer
export class LogLine extends Component<LogLineProps, { open: boolean }> {
    state = { open: true };
    private stackId = `log-stack-${nextId++}`;

    private get open() {
        return this.props.expanded ?? this.state.open;
    }

    private toggle = () => {
        const next = !this.open;
        if (this.props.expanded === undefined) this.setState({ open: next });
        this.props.onToggle?.(next);
    };

    render() {
        const { entry } = this.props;
        const stack = entry.stack?.length ? entry.stack : undefined;
        const open = !!stack && this.open;
        const app = stack?.filter(f => !isFrameworkFrame(f));
        // All-framework stacks stay listed: nothing else to look at
        const shown = app?.length ? app : stack ?? [];
        const hidden = (stack?.length ?? 0) - shown.length;
        return (
            <div className={`log-line log-${entry.level}${open ? ' log-open' : ''}${this.props.hideSource ? ' log-nosrc' : ''}`}>
                <span className="log-ts" title={formatLogDateTime(entry.ts)}>{formatLogTime(entry.ts)}</span>
                <span className="log-level">{entry.level}</span>
                {!this.props.hideSource && <span className="log-src" title={entry.source}>{entry.source}</span>}
                <span className="log-msg">{entry.message}</span>
                {entry.causeId !== undefined && this.props.onJumpToCause && (
                    <button type="button" className="log-jump" onClick={() => this.props.onJumpToCause!(entry.causeId!)}>jump to cause ↓</button>
                )}
                {stack && (
                    <div className="log-stack-block">
                        <button type="button" className="log-stack-toggle" aria-expanded={open} aria-controls={this.stackId} onClick={this.toggle}>
                            {open ? '▾' : '▸'} Stack trace · source-mapped
                        </button>
                        {open && (
                            <ol id={this.stackId} className="log-stack">
                                {shown.map((f, i) => (
                                    <li key={i} className="log-frame">
                                        at {f.fn ? <>{f.fn} (</> : null}
                                        {f.href ? <a href={f.href}>{frameLoc(f)}</a> : frameLoc(f)}
                                        {f.fn ? ')' : null}
                                    </li>
                                ))}
                                {hidden > 0 && <li className="log-frame log-frame-fold">… {hidden} framework {hidden === 1 ? 'frame' : 'frames'}</li>}
                            </ol>
                        )}
                    </div>
                )}
            </div>
        );
    }
}
