import { store, with_meta_components } from '@matchlighter/meta_components';
import type { CrossCallRow, SharedStoreRow, SystemSnapshot } from '@protocol';
import { observer } from 'mobx-react';
import { Component, Fragment } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyPathButton } from '../components/CopyPathButton';
import { ListStates } from '../components/ListStates';
import { JsonViewer } from '../components/JsonViewer';
import { RelativeTime } from '../components/RelativeTime';
import { StateBadge } from '../components/StateBadge';
import { StorageKeyRow } from '../components/StorageKeyRow';
import { dash, formatBytes } from '../format';
import { appHref } from '../hrefs';
import { ConfirmedAction } from '../stores/confirmed_action';
import { combinedListStatus, TopicStore } from '../stores/topic_store';
import '../styles/appdetail.css';
import '../styles/system.css';
import { rowValue } from './storage_model';
import { isStuck, sortCalls } from './system_model';


function Location({ location }: { location?: SystemSnapshot['location'] }) {
    const { latitude, longitude, elevation } = location ?? {};
    const coords = latitude != null && longitude != null ? `${latitude}, ${longitude}${elevation != null ? ` · ${elevation} m` : ''}` : undefined;
    return (
        <>
            <dt>Location</dt><dd className="mono">{dash(coords)}</dd>
        </>
    );
}

function CallRow({ call, onCancel }: { call: CrossCallRow, onCancel: (c: CrossCallRow) => void }) {
    const stuck = isStuck(call);
    const note = stuck ? (call.targetState ? 'is dead' : 'is missing') : undefined;
    return (
        <tr data-call={call.uuid} data-stuck={stuck ? '' : undefined} className={stuck ? 'sys-stuck' : undefined}>
            <td className="sys-route mono" data-label="Call">
                <a href={appHref(call.source)}>{call.source}</a>
                <span className="sys-arrow" aria-label="calls">→</span>
                <a href={appHref(call.target)}>{call.target}</a>
                .{call.method}({call.args ?? ''})
            </td>
            <td data-label="Status"><StateBadge kind="call" state={call.status} /></td>
            <td data-label="Age">{call.since != null ? <RelativeTime at={call.since} /> : '—'}</td>
            <td data-label="Timeout">{call.timeoutAt != null ? <RelativeTime at={call.timeoutAt} /> : '—'}</td>
            <td className="sys-note" data-label="Note">
                {note ? <span className="sys-stuck-note" role="status">Target <a href={appHref(call.target)}>{call.target}</a> {note}</span> : <span className="muted">—</span>}
            </td>
            <td className="sys-actions">
                {call.status === 'pending' && <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => onCancel(call)}>Cancel…</button>}
            </td>
        </tr>
    );
}

@with_meta_components
@observer
export class System extends Component {
    /** Everything but the shared stores comes from the app-wide `app.system`; the stores are only subscribed to while this page is open */
    @store storesPart = new TopicStore(app.connection, 'system', { stores: true });

    private cancelling = new ConfirmedAction<CrossCallRow>({
        call: c => app.connection.call('crossCall.cancel', { uuid: c.uuid }),
        failure: (c, message) => `Could not cancel ${c.source} → ${c.target}.${c.method}: ${message}`,
        closeOnConfirm: true,
    });


    /** Names of the stores whose key list is expanded */
    state = { open: new Set<string>() };

    private toggleStore(name: string) {
        this.setState(({ open }: { open: Set<string> }) => {
            const next = new Set(open);
            if (!next.delete(name)) next.add(name);
            return { open: next };
        });
    }

    /**
     * Mock: "Stores used by more than one app". `usedBy` is in-memory (resets on restart), so a store that holds data is kept even with
     * <=1 known user (may still be shared); only empty stores with <=1 user are hidden.
     */
    static isShared(s: SharedStoreRow) {
        return s.usedBy.length > 1 || s.rows.length > 0;
    }

    private renderStore(s: SharedStoreRow) {
        const scopeOf = (key: string) => `shared-storage/${s.name}/${key}`;
        const rows = [...s.rows].sort((a, b) => a.key.localeCompare(b.key));
        const open = this.state.open.has(s.name);
        const lastWrite = rows.reduce((m, r) => Math.max(m, r.writtenAt), 0);
        const panelId = `sys-store-${s.name}`;
        return (
            <Fragment key={s.name}>
                <tr data-store={s.name} aria-label={`Shared store ${s.name}`}>
                    <td className="mono" data-label="Store">shared:{s.name}</td>
                    <td data-label="Keys">{rows.length}</td>
                    <td className="mono" data-label="Size">{formatBytes(rows.reduce((n, r) => n + r.size, 0))}</td>
                    <td className="mono" data-label="Used by">
                        {s.usedBy.length === 0 ? <span className="muted">—</span> : s.usedBy.map((id, i) => (
                            <Fragment key={id}>{i > 0 && ', '}<a className="sys-user" href={appHref(id)}>{id}</a></Fragment>
                        ))}
                    </td>
                    <td data-label="Last write">{lastWrite ? <RelativeTime at={lastWrite} /> : '—'}</td>
                    <td className="sys-actions">
                        <button type="button" className="btn btn-sm" aria-expanded={open} aria-controls={panelId} onClick={() => this.toggleStore(s.name)}>
                            {open ? 'Close' : 'Open'}
                        </button>
                    </td>
                </tr>
                {open && (
                    <tr className="sys-store-detail" id={panelId}>
                        <td colSpan={6}>
                            <code className="mono sys-path">{s.path}</code>
                            {rows.length === 0 ? <p className="note">No stored keys.</p> : (
                                <div className="sys-store-rows">
                                    {rows.map(r => (
                                        <StorageKeyRow key={r.key} storageKey={r.key} scope={scopeOf(r.key)} value={rowValue(r)}
                                            loader={() => app.connection.call('sharedStorage.value', { store: s.name, key: r.key })}
                                            size={r.size} writtenAt={r.writtenAt} internal={r.internal} changedAt={r.writtenAt} />
                                    ))}
                                </div>
                            )}
                        </td>
                    </tr>
                )}
            </Fragment>
        );
    }

    render() {
        const sys = app.system.data, stores = this.storesPart.data?.stores?.filter(System.isShared);
        const calls = sortCalls(sys?.crossCalls ?? []);
        return (
            <>
                <div className="page-title"><h1>System</h1></div>
                <ListStates
                    status={combinedListStatus(app.system, this.storesPart)}
                    error={{ title: "Couldn't load system info", detail: app.system.error ?? this.storesPart.error }}
                    syncingLabel="Syncing system…"
                >
                    {sys && stores && (
                        <div className="sys">
                            <div className="sys-top">
                                <section className="card appd-details" aria-labelledby="sys-hv">
                                    <h2 id="sys-hv">Hypervisor</h2>
                                    <dl className="appd-kv">
                                        <dt>State</dt><dd><StateBadge kind="hypervisor" state={sys.state} /></dd>
                                        <dt>Version</dt><dd className="mono">{dash(sys.version)} · node {sys.nodeVersion.split('.').slice(0, 2).join('.')}</dd>
                                        <dt>Uptime</dt><dd><RelativeTime at={sys.startedAt} mode="age" /></dd>
                                        <dt>Config file</dt>
                                        <dd className="sys-file">
                                            <code className="mono sys-path">{dash(sys.configPath)}</code>
                                            {sys.configPath && (
                                                <CopyPathButton path={sys.configPath!} />
                                            )}
                                        </dd>
                                        <dt>Timezone</dt><dd>{dash(sys.location?.timezone)}</dd>
                                        <Location location={sys.location} />
                                    </dl>
                                </section>

                                {sys.resolvedConfig && (
                                    <section className="card sys-config" aria-label="Resolved system config">
                                        <h2>Resolved system config <span className="note">read-only</span></h2>
                                        <JsonViewer value={sys.resolvedConfig} scope="system-config" />
                                    </section>
                                )}
                            </div>

                            <section className="sys-section" aria-label="Cross-app calls">
                                <div className="sys-section-head">
                                    <h2>Cross-app calls</h2>
                                    <span className="cnt">{calls.length}</span>
                                    <span className="note">Persisted RPC — survives restarts; pending calls wait for their target.</span>
                                </div>
                                <ActionError error={this.cancelling.error} />
                                {calls.length === 0 ? <p className="note">No pending cross-app calls.</p> : (
                                    <div className="tbl-wrap">
                                        <table className="tbl tbl-stack sys-calls">
                                            <thead><tr><th>Call</th><th>Status</th><th>Age</th><th>Timeout</th><th>Note</th><th aria-label="Actions" /></tr></thead>
                                            <tbody>{calls.map(c => <CallRow key={c.uuid} call={c} onCancel={c => this.cancelling.request(c)} />)}</tbody>
                                        </table>
                                    </div>
                                )}
                                <p className="note">A pending call runs once its target app starts. Calls to a dead app wait until it is fixed or they time out.</p>
                                <ConfirmDialog
                                    open={!!this.cancelling.confirming}
                                    title={this.cancelling.confirming ? `Cancel ${this.cancelling.confirming.source} → ${this.cancelling.confirming.target}.${this.cancelling.confirming.method}()?` : ''}
                                    will={<>Drop the call, so it never runs. <code>{this.cancelling.confirming?.source}</code> sees the call fail with "Cancelled".</>}
                                    wont={<>Stop or change either app.</>}
                                    confirmLabel="Cancel call"
                                    onConfirm={() => void this.cancelling.confirm()}
                                    onCancel={() => this.cancelling.cancel()}
                                />
                            </section>

                            <section className="sys-section" aria-label="Shared storage">
                                <div className="sys-section-head">
                                    <h2>Shared storage</h2>
                                    <span className="note">Stores used by more than one app</span>
                                </div>
                                {stores.length === 0
                                    ? <p className="note">No shared stores.</p>
                                    : (
                                        <div className="tbl-wrap">
                                            <table className="tbl tbl-stack sys-stores">
                                                <thead><tr><th>Store</th><th>Keys</th><th>Size</th><th>Used by</th><th>Last write</th><th aria-label="Actions" /></tr></thead>
                                                <tbody>{stores.map(s => this.renderStore(s))}</tbody>
                                            </table>
                                        </div>
                                    )}
                            </section>
                        </div>
                    )}
                </ListStates>
            </>
        );
    }
}
