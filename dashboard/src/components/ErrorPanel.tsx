import { mdiAlertCircleOutline } from '@mdi/js';
import type { CodeFrame, CrossCallRow, ErrorFrame, PluginRow } from '@protocol';
import { appHref, pluginHref } from '../hrefs';
import { pluginBadge } from '../views/plugins_model';
import { copyText } from './clipboard';
import { Icon } from './Icon';
import { RelativeTime } from './RelativeTime';
import { StateBadge } from './StateBadge';
import '../styles/errorpanel.css';

export interface ErrorPanelProps {
    /** Lifecycle phase the failure happened in */
    phase: string;
    message: string;
    /** Source-mapped */
    frames: ErrorFrame[];
    /** Source lines around the failing frame */
    codeFrame?: CodeFrame;
    /** Adds an "Open in logs" link */
    logsHref?: string;
    /** Adds a "Dependencies at failure" card: a startup failure is often a plugin that is down */
    plugins?: Pick<PluginRow, 'id' | 'type' | 'state' | 'connection'>[];
    /** Adds a "Blocked by this" card: cross-app calls waiting for this app to start */
    blockedCalls?: Pick<CrossCallRow, 'source' | 'target' | 'method' | 'timeoutAt'>[];
}

const loc = (f: ErrorFrame) => `${f.file}:${f.line}${f.col != null ? `:${f.col}` : ''}`;

/** Runtime/library frames (absolute path, `node:` internals, `node_modules`) as opposed to the app's own; the server leaves in-project files relative */
export const isFrameworkFrame = (f: ErrorFrame) =>
    f.file.startsWith('/') || /^[a-z]:[\\/]/i.test(f.file) || f.file.startsWith('node:') || f.file.split('/').includes('node_modules');

/** Plain-text form of the failure, for the Copy button */
export function errorText(phase: string, message: string, frames: ErrorFrame[]): string {
    return [`Failed during ${phase}: ${message}`, ...frames.map(f => `    at ${f.fn ? `${f.fn} (${loc(f)})` : loc(f)}`)].join('\n');
}

function Code({ frame }: { frame: CodeFrame }) {
    return (
        <div className="errpanel-code" role="group" aria-label="Source around the failure">
            {frame.lines.flatMap(l => {
                const hit = l.n === frame.line;
                const row = <div key={l.n} className={hit ? 'ln hit' : 'ln'}><span className="n">{l.n}</span><span>{l.text}</span></div>;
                return hit && frame.col
                    ? [row, <div key={`${l.n}^`} className="ln caret" aria-hidden><span className="n" /><span>{' '.repeat(frame.col - 1) + '^'}</span></div>]
                    : [row];
            })}
        </div>
    );
}

const Frame = ({ f }: { f: ErrorFrame }) => (
    <li>{f.fn && <span className="errpanel-fn">{f.fn} </span>}<span className="errpanel-loc">{loc(f)}</span></li>
);

/** The app's own frames in the open, framework frames behind a count; the full stack stays one click away */
function Stack({ frames }: { frames: ErrorFrame[] }) {
    const own = frames.filter(f => !isFrameworkFrame(f));
    const hidden = frames.length - own.length;
    return (
        <>
            <span className="mono errpanel-top"><span className="errpanel-loc">{loc(frames[0])}</span>{frames[0].fn && <span className="errpanel-muted">{` in ${frames[0].fn}`}</span>}</span>
            {hidden > 0 && <span className="mono errpanel-muted errpanel-hidden">{`… ${hidden} framework ${hidden === 1 ? 'frame' : 'frames'} hidden`}</span>}
            <details className="errpanel-stack">
                <summary>{`Full stack (${frames.length} frames)`}</summary>
                <ol className="errpanel-frames mono">{frames.map((f, i) => <Frame key={i} f={f} />)}</ol>
            </details>
        </>
    );
}

const pluginHealthy = (p: Pick<PluginRow, 'state' | 'connection'>) =>
    p.state === 'started' && (p.connection === undefined || p.connection === 'connected' || p.connection === 'listening');

function Plugins({ plugins }: { plugins: NonNullable<ErrorPanelProps['plugins']> }) {
    return (
        <section className="card errpanel-plugins" aria-label="Dependencies at failure">
            <span className="lbl">Dependencies at failure</span>
            <ul>
                {plugins.map(p => (
                    <li key={p.id} data-plugin={p.id}>
                        <a className="mono" href={pluginHref(p.id)}>{p.id}</a>
                        <StateBadge {...pluginBadge(p)} />
                    </li>
                ))}
            </ul>
            {plugins.every(pluginHealthy) && <span className="errpanel-muted errpanel-hint">Plugins were healthy, so this is an app bug — not a connection issue.</span>}
        </section>
    );
}

function Blocked({ calls }: { calls: NonNullable<ErrorPanelProps['blockedCalls']> }) {
    const timeoutAt = Math.min(...calls.map(c => c.timeoutAt ?? Infinity));
    return (
        <section className="card errpanel-blocked" aria-label="Blocked by this">
            <span className="lbl">Blocked by this</span>
            <ul>
                {calls.map((c, i) => (
                    <li key={i} className="mono"><a href={appHref(c.source)}>{c.source}</a>{` → ${c.target}.${c.method}`}</li>
                ))}
            </ul>
            <span className="errpanel-muted errpanel-hint">
                {`${calls.length} cross-app ${calls.length === 1 ? 'call' : 'calls'} pending`}
                {Number.isFinite(timeoutAt) && <> · times out <RelativeTime at={timeoutAt} /></>}
            </span>
        </section>
    );
}

/** Startup failure (design "Hot reload" dead variant): the error panel (where it failed, message, source excerpt, stack) beside cards for what it depended on and what waits on it */
export function ErrorPanel({ phase, message, frames, codeFrame, logsHref, plugins, blockedCalls }: ErrorPanelProps) {
    const hasPlugins = !!plugins && plugins.length > 0, hasBlocked = !!blockedCalls && blockedCalls.length > 0;
    return (
        <div className="errpanel-layout">
            <section className="errpanel" role="alert" data-error-panel>
                <div className="errpanel-head">
                    <Icon path={mdiAlertCircleOutline} size={20} className="errpanel-icon" />
                    <div className="errpanel-what">
                        <h2 className="errpanel-title">Failed during <span className="mono">{phase}</span></h2>
                        <pre className="errpanel-msg mono">{message}</pre>
                    </div>
                    <div className="errpanel-actions">
                        <button type="button" className="btn btn-sm" onClick={() => void copyText(errorText(phase, message, frames)).catch(() => { })}>Copy</button>
                        {logsHref && <a className="btn btn-sm" href={logsHref}>Open in logs</a>}
                    </div>
                </div>
                {codeFrame && <Code frame={codeFrame} />}
                {frames.length > 0 && <Stack frames={frames} />}
            </section>
            {(hasPlugins || hasBlocked) && (
                <aside className="errpanel-side">
                    {hasPlugins && <Plugins plugins={plugins} />}
                    {hasBlocked && <Blocked calls={blockedCalls} />}
                </aside>
            )}
        </div>
    );
}
