import { store, with_meta_components } from '@matchlighter/meta_components';
import { mdiAlertOutline, mdiFilterVariant, mdiRefresh } from '@mdi/js';
import type { AppRow, OrphanRow, OrphanSummary } from '@protocol';
import { observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component, type ReactNode } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { ListStates } from '../components/ListStates';
import { RowMenu, type RowMenuItem } from '../components/RowMenu';
import { RelativeTime } from '../components/RelativeTime';
import { Segmented } from '../components/Segmented';
import { StateBadge } from '../components/StateBadge';
import { formatBytes, plural } from '../format';
import { appHref, errorLogsHref } from '../hrefs';
import { ConfirmedAction } from '../stores/confirmed_action';
import { Flash } from '../stores/flash';
import { TopicStore } from '../stores/topic_store';
import '../styles/apps.css';
import { actionsFor, appBadge, isSettling, type AppAction } from './app_detail_model';
import { APP_SEGMENTS, filterApps, segmentCounts, type AppSegment } from './apps_model';

const SEGMENT_LABEL: Record<AppSegment, string> = { all: 'All', running: 'Running', dead: 'Dead', stopped: 'Stopped' };
const ACTION_LABEL: Record<AppAction, string> = { restart: 'Restart', stop: 'Stop', start: 'Start' };
const count = (n: number | undefined, settling: boolean) => settling ? '…' : n ?? '—';

function Uptime({ row }: { row: AppRow }) {
    if (row.state === 'started') return <RelativeTime at={row.since} mode="age" />;
    if (row.state === 'dead') return <>dead <RelativeTime at={row.since} mode="age" /></>;
    return <>—</>;
}

/** One table row. State changes (incl. each hot-reload step) flash it; keyed by app id so a restart keeps the row. */
@with_meta_components
@observer
class AppTableRow extends Component<{ row: AppRow }> {
    @store flash = new Flash(() => this.props.row.state, 1200);

    /** Row actions run at once, like the detail header's */
    private action = new ConfirmedAction<AppAction>({ call: a => app.connection.call(`app.${a}`, { id: this.props.row.id }) });

    componentDidUpdate() { this.flash.check(); }

    private actions() {
        const { row } = this.props;
        const available = actionsFor(row, this.action.running);
        const menu: RowMenuItem[] = [
            ...available.filter(a => a !== 'restart').map(a => ({ key: a, label: ACTION_LABEL[a], onSelect: () => void this.action.run(a) })),
            { key: 'logs', label: 'Open logs', href: appHref(row.id, 'logs') },
        ];
        return (
            <>
                {available.includes('restart') && (
                    <button type="button" className="icon-btn" aria-label={`Restart ${row.id}`} title="Restart" disabled={this.action.busy}
                        onClick={() => void this.action.run('restart')}>
                        <Icon path={mdiRefresh} size={16} />
                    </button>
                )}
                <RowMenu label={`More actions for ${row.id}`} items={menu} />
                <ActionError error={this.action.error} />
            </>
        );
    }

    render() {
        const { row } = this.props;
        const settling = isSettling(row.state);
        return (
            <tr className={this.flash.active ? (row.state === 'started' ? 'flash-ok' : 'flash') : undefined} data-app={row.id}>
                <td data-label="State"><StateBadge {...appBadge(row, this.action.running)} /></td>
                <td className="apps-name">
                    <a href={appHref(row.id)}>{row.name}</a>
                    <span className="mono apps-id">{row.id}</span>
                </td>
                <td className="apps-source">
                    <div className="apps-source-inner">
                        <span className="mono">{row.source}</span>
                        {row.kind && <Chip mono>{row.kind}</Chip>}
                    </div>
                </td>
                <td data-label="Up"><Uptime row={row} /></td>
                <td className="num" data-label="Entities">
                    {count(row.entities, settling)}
                    {!settling && !!row.unlinkedEntities && <span className="apps-unlinked">+{row.unlinkedEntities} unlinked</span>}
                </td>
                <td className="num" data-label="Schedules">{count(row.schedules, settling)}</td>
                <td className="num" data-label="Resumables">{count(row.resumables, settling)}</td>
                <td className="apps-error-cell">
                    {row.error && (
                        <span className="mono apps-error" title={`Failed during ${row.error.phase}: ${row.error.message}`}>{row.error.message}</span>
                    )}
                </td>
                <td className="apps-actions">{this.actions()}</td>
            </tr>
        );
    }
}

/** Leftover chips of an orphan row: what a cleanup would release (omits kinds with nothing to release) */
export function leftoverChips(s: OrphanSummary): string[] {
    return [
        s.entities > 0 && `${s.entities} HA ${s.entities === 1 ? 'entity' : 'entities'}`,
        s.storageKeys > 0 && `storage ${plural(s.storageKeys, 'key')}`,
        `dir ${formatBytes(s.dirBytes)}`,
    ].filter((c): c is string => !!c);
}

function OrphanTableRow({ orphan }: { orphan: OrphanRow }) {
    const { id, summary } = orphan;
    return (
        <tr data-orphan={id}>
            <td data-label="State"><StateBadge kind="app" state="orphan" /></td>
            <td className="apps-name"><span className="mono">{id}</span></td>
            <td data-label="Removed">{summary ? <RelativeTime at={summary.removedAt} /> : '—'}</td>
            <td data-label="Leftovers">
                {summary && <span className="apps-chips">{leftoverChips(summary).map(c => <Chip key={c}>{c}</Chip>)}</span>}
            </td>
            <td data-label="Pending destroyers">
                {summary && <span className="mono apps-destroyers">{summary.destroyers.join(', ') || '—'}</span>}
            </td>
            <td className="apps-orphan-actions">
                <a className="btn btn-sm" href={appHref(id, 'leftovers')}>View leftovers</a>
                <a className="btn btn-sm btn-danger-outline" href={appHref(id, 'cleanup')}>Clean up…</a>
            </td>
        </tr>
    );
}

function Orphans({ orphans }: { orphans: OrphanRow[] }) {
    return (
        <section className="card apps-orphans" aria-label="Orphaned apps">
            <header className="apps-orphans-head">
                <Icon path={mdiAlertOutline} size={18} className="apps-orphans-icon" />
                <h2>Orphaned apps</h2>
                <span className="cnt">{orphans.length}</span>
                <span className="note">Removed from config, but leftovers still exist. Cleanup runs their destroyers.</span>
            </header>
            <div className="tbl-wrap">
                <table className="tbl tbl-stack apps-orphan-table">
                    <thead>
                        <tr><th>State</th><th>App</th><th>Removed</th><th>Leftovers</th><th>Pending destroyers</th><th /></tr>
                    </thead>
                    <tbody>{orphans.map(o => <OrphanTableRow key={o.id} orphan={o} />)}</tbody>
                </table>
            </div>
        </section>
    );
}

@with_meta_components
@observer
export class Apps extends Component<{ children?: ReactNode }> {
    @store apps = new TopicStore(app.connection, 'apps');

    private ui = observable({ segment: 'all' as AppSegment, text: '' });

    render() {
        const { data, error } = this.apps;
        const configPath = app.system.data?.configPath;
        const all = data?.apps ?? [];
        const counts = segmentCounts(all);
        const rows = filterApps(all, this.ui.segment, this.ui.text);
        const filtered = this.ui.segment !== 'all' || !!this.ui.text.trim();
        return (
            <>
                <div className="page-title">
                    <h1>Apps</h1>
                    <div className="apps-controls">
                        <Segmented label="Filter by state" value={this.ui.segment} onChange={v => { this.ui.segment = v }}
                            options={APP_SEGMENTS.map(value => ({ value, label: SEGMENT_LABEL[value], count: counts[value], err: value === 'dead' }))} />
                        <label className="input-pill input-pill-card apps-filter">
                            <Icon path={mdiFilterVariant} size={16} />
                            <input type="search" placeholder="Filter by id, source…" aria-label="Filter apps"
                                value={this.ui.text} onChange={e => { this.ui.text = e.target.value }} />
                        </label>
                    </div>
                </div>
                <ListStates
                    status={this.apps.listStatus}
                    isEmpty={rows.length === 0}
                    empty={filtered
                        ? { title: 'No matching apps', hint: 'Nothing matches the current state and text filters.' }
                        : { title: 'No apps configured', hint: 'Declare apps in the TypeDaemon config file; they show up here as soon as it is saved.' }}
                    error={{ title: "Couldn't load apps", detail: error }}
                    syncingLabel="Syncing apps…"
                >
                    <div className="tbl-wrap">
                        <table className="tbl tbl-stack apps-table">
                            <thead>
                                <tr>
                                    <th>State</th><th>App</th><th>Source</th><th>Up</th>
                                    <th className="num">Entities</th><th className="num">Schedules</th><th className="num">Resumables</th><th>Last error</th>
                                    <th><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody>{rows.map(r => <AppTableRow key={r.id} row={r} />)}</tbody>
                        </table>
                    </div>
                </ListStates>
                {data && data.orphans.length > 0 && <Orphans orphans={data.orphans} />}
                <p className="note">
                    Apps are declared in {configPath ? <span className="mono">{configPath}</span> : 'the TypeDaemon config file'}. Add or remove them there — this page reflects changes live.
                </p>
                {this.props.children}
            </>
        );
    }
}
