import { mdiMagnify, mdiPause } from '@mdi/js';
import type { LogLevel, LogRow } from '@protocol';
import { observer } from 'mobx-react';
import { Component, type ReactNode } from 'react';
import { ALL_LEVELS, logsAsNdjson, lastError, type ChannelFilter, type LogSourceKind } from '../views/logs_model';
import type { LogsViewState } from '../views/logs_view_state';
import '../styles/logspanel.css';
import { downloadText } from './download';
import { Icon } from './Icon';
import { ListStates, type ListStatus } from './ListStates';
import { LogList } from './LogList';
import { FilterChips } from './FilterChips';
import { Segmented, SegmentedMulti } from './Segmented';

export interface LogsPanelProps {
    /** Every line the subscription has, oldest first. Filtering is done here, by `state` */
    rows: readonly LogRow[];
    state: LogsViewState;
    status: ListStatus;
    error?: string;
    /** What would put lines here (empty state) */
    emptyHint?: string;
    /** Offer a filter by source kind (system / plugins / apps), for views that mix sources */
    sourceFilter?: boolean;
    /** Page heading shown at the left of the status row (views that own their page title) */
    title?: ReactNode;
    /** One source's tab (app detail): everything in one card (toolbar, lines, tail footer), no source column, no header row, no Latest error */
    scoped?: boolean;
}

const CHANNELS: { value: ChannelFilter; label: string }[] = [{ value: 'user', label: 'User' }, { value: 'manager', label: 'Manager' }, { value: 'both', label: 'Both' }];
const KIND_OPTIONS: { value: LogSourceKind; label: string }[] = [{ value: 'app', label: 'all apps' }, { value: 'plugin', label: 'plugins' }, { value: 'system', label: 'system' }];
const LEVEL_OPTIONS = ALL_LEVELS.map(l => ({ value: l, label: l }));

/**
 * Log viewer: filters (channel, level, text), tail with pause/resume + status row, NDJSON download of the buffer, jump to the newest error, virtualized list.
 * Takes rows from any `logs` subscription (one app, or all sources), so views only choose what to subscribe to.
 */
@observer
export class LogsPanel extends Component<LogsPanelProps> {
    private renderDownload(rows: readonly LogRow[]) {
        return (
            <button type="button" className="btn btn-sm" title="Download the buffered lines as NDJSON" disabled={rows.length === 0}
                onClick={() => downloadText(`typedaemon-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`, logsAsNdjson(rows), 'application/x-ndjson')}>Download</button>
        );
    }

    render() {
        const { rows, state, status, error, emptyHint = 'Lines appear here as they are logged.', sourceFilter, title, scoped } = this.props;
        const shown = state.visible(rows);
        const pending = state.pendingCount(rows);
        const hasError = lastError(rows) !== undefined;
        const tail = (
            <div className={`${scoped ? 'logs-foot' : 'logs-tail'}${state.paused ? ' paused' : ''}`} role="status">
                <span className="logs-dot" aria-hidden="true" />
                {scoped
                    ? (state.paused ? 'Paused — new lines held' : 'Tailing — new lines appear here')
                    : (state.paused ? 'paused — new lines held' : 'waiting for new lines…')}
            </div>
        );
        const list = shown.length === 0
            ? <><div className="liststate-center"><div className="liststate-title">No lines match</div><div className="liststate-hint">Adjust the source, channel, level or search filters.</div></div>{scoped && tail}</>
            : <LogList rows={shown} follow={!state.paused} focusId={state.focusId} hideSource={scoped} footer={tail}
                isExpanded={id => state.isExpanded(id)} onToggle={(id, open) => state.setExpanded(id, open)}
                onScrollAway={() => state.pause(rows)} onJumpToCause={id => state.jumpToLog(rows, id)} />;
        const states = {
            status, isEmpty: rows.length === 0, empty: { title: 'No log lines', hint: emptyHint },
            error: { title: "Couldn't load logs", detail: error }, syncingLabel: 'Syncing logs…',
        };
        if (scoped) {
            return (
                <section className="card logs-card">
                    <ListStates {...states}>
                        <div className="logs-bar">
                            <Segmented label="Log stream" value={state.channel} options={CHANNELS} onChange={c => state.setChannel(c)} />
                            <SegmentedMulti<LogLevel> label="Levels" values={state.levels} options={LEVEL_OPTIONS} onChange={l => state.setLevels(l)} />
                            <label className="input-pill logs-search">
                                <input type="search" placeholder="Search messages" aria-label="Search logs"
                                    value={state.search} onChange={e => state.setSearch(e.target.value)} />
                            </label>
                            {state.paused
                                ? <button type="button" className="btn btn-sm btn-primary" onClick={() => state.resume()}>Resume tail{pending ? ` · ${pending} new` : ''}</button>
                                : <button type="button" className="btn btn-sm" onClick={() => state.pause(rows)}><Icon path={mdiPause} size={12} />Pause tail</button>}
                            {this.renderDownload(rows)}
                        </div>
                        {list}
                    </ListStates>
                </section>
            );
        }
        return (
            <section className="logs">
                <div className="logs-head">
                    {title && <h1 className="logs-title">{title}</h1>}
                    <span className="logs-spacer" />
                    <span className={`logs-status${state.paused ? ' paused' : ''}`} role="status">
                        <span className="logs-dot" aria-hidden="true" />
                        {state.paused ? 'Paused' : 'Tailing'} · {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'line' : 'lines'} buffered
                    </span>
                    {state.paused
                        ? <button type="button" className="btn btn-sm btn-primary" onClick={() => state.resume()}>Resume{pending ? ` · ${pending} new` : ''}</button>
                        : <button type="button" className="btn btn-sm" onClick={() => state.pause(rows)}><Icon path={mdiPause} size={12} />Pause</button>}
                    {this.renderDownload(rows)}
                </div>
                <ListStates {...states}>
                    <div className="logs-bar card logs-filters">
                        {sourceFilter && <FilterChips<LogSourceKind> label="source" values={state.kinds} options={KIND_OPTIONS} onChange={k => state.setKinds(k)} />}
                        <Segmented label="Log channel" value={state.channel} options={CHANNELS} onChange={c => state.setChannel(c)} />
                        <SegmentedMulti<LogLevel> label="Log levels" values={state.levels} options={LEVEL_OPTIONS} onChange={l => state.setLevels(l)} />
                        <label className="input-pill logs-search">
                            <Icon path={mdiMagnify} size={16} />
                            <input type="search" placeholder="Search text or /regex/" aria-label="Search logs"
                                value={state.search} onChange={e => state.setSearch(e.target.value)} />
                        </label>
                        <button type="button" className="btn btn-sm" title="Scroll to the newest error line" disabled={!hasError} onClick={() => state.jumpToLastError(rows)}>Latest error</button>
                    </div>
                    {list}
                </ListStates>
            </section>
        );
    }
}
