import { mount_effect, store, with_meta_components } from '@matchlighter/meta_components';
import { mdiDeleteOutline } from '@mdi/js';
import { observable, reaction } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { InternalKeysToggle } from '../components/InternalKeysToggle';
import { Icon } from '../components/Icon';
import { ListStates } from '../components/ListStates';
import { InfoBanner } from '../components/InfoBanner';
import { StorageKeyRow, StorageTableHead } from '../components/StorageKeyRow';
import { ConfirmedAction } from '../stores/confirmed_action';
import { scopedPath, sharedJsonViewState } from '../stores/json_view_state';
import { TopicStore } from '../stores/topic_store';
import '../styles/appstorage.css';
import { rowValue, visibleStorageRows } from './storage_model';

/** Deleting only touches the store; the running app is not told */
const CAVEAT = <>A running app keeps its in-memory value until it writes the key again or restarts.</>;

/**
 * App detail "Storage" tab. Subscribed for as long as the tab is shown. Every row's JSON viewer is scoped to
 * `<app>/<key>` in the shared (persisted) open state, so open nodes survive deltas, restarts and reloads.
 */
@with_meta_components
@observer
export class AppStorageTab extends Component<{ appId: string }> {
    private jsonState = sharedJsonViewState();

    private scopeOf = (key: string) => `storage/${this.props.appId}/${key}`;
    private loaderFor = (key: string) => () => app.connection.call('storage.value', { app: this.props.appId, key });

    @store storage = new TopicStore(app.connection, 'appStorage', { id: this.props.appId });

    /** A write (new `writtenAt`) replaces the key's value: fetch again whatever lazy value of it was already loaded. A resent snapshot with the same `writtenAt` (reconnect) does not */
    @mount_effect
    refreshWrittenValues() {
        return reaction(() => this.storage.data?.rows, (rows, prev) => {
            if (!prev) return;
            const before = new Map(prev.map(r => [r.key, r]));
            for (const r of rows ?? []) {
                if (r.lazy && before.get(r.key)?.writtenAt !== r.writtenAt) void this.jsonState.refresh(scopedPath(this.scopeOf(r.key), '$'), this.loaderFor(r.key));
            }
        });
    }

    private ui = observable({ showInternal: false, filter: '' });

    private deletion = new ConfirmedAction<string>({
        call: key => app.connection.call('storage.delete', { app: this.props.appId, key }),
        failure: (key, message) => `Couldn't delete ${key}: ${message}`,
    });

    render() {
        const { data, error } = this.storage;
        const { rows, internal } = visibleStorageRows(data?.rows ?? [], this.ui.showInternal, this.ui.filter);
        const filtered = this.ui.filter.trim() !== '';
        const target = this.deletion.confirming;
        return (
            <section className="stor card stor-card">
                <div className="stor-bar">
                    <input type="search" className="input-pill" placeholder="Filter keys" aria-label="Filter keys"
                        value={this.ui.filter} onChange={e => { this.ui.filter = e.target.value }} />
                    <InternalKeysToggle checkbox count={internal} shown={this.ui.showInternal} onToggle={() => { this.ui.showInternal = !this.ui.showInternal }} />
                    {data?.path && <span className="stor-meta note">Store: <code className="stor-path mono">{data.path}</code> · live</span>}
                </div>
                <InfoBanner>Deleting a key removes it from the store only. The running app keeps its in-memory value until it writes that key again or restarts.</InfoBanner>
                <ActionError error={this.deletion.error} />
                <ListStates
                    status={this.storage.listStatus}
                    isEmpty={rows.length === 0}
                    empty={filtered
                        ? { title: 'No matching keys', hint: `No stored key contains "${this.ui.filter.trim()}".` }
                        : { title: 'No stored keys', hint: 'Values the app persists (e.g. with @persistent properties) show up here as it writes them.' }}
                    error={{ title: "Couldn't load storage", detail: error }}
                    syncingLabel="Syncing storage…"
                >
                    <div className="skey-table">
                        <StorageTableHead />
                        {rows.map(r => (
                            <StorageKeyRow key={r.key} layout="table" storageKey={r.key} scope={this.scopeOf(r.key)} value={rowValue(r)}
                                loader={this.loaderFor(r.key)} size={r.size} writtenAt={r.writtenAt} internal={r.internal}
                                changedAt={r.writtenAt}
                                action={(
                                    <button type="button" className="icon-btn" aria-label={`Delete ${r.key}`} title="Delete from store" disabled={this.deletion.busy}
                                        onClick={() => this.deletion.request(r.key)}>
                                        <Icon path={mdiDeleteOutline} size={16} />
                                    </button>
                                )} />
                        ))}
                    </div>
                </ListStates>
                <ConfirmDialog
                    open={target !== undefined}
                    title={target !== undefined ? `Delete key ${target}?` : ''}
                    will={<>Remove the key and its value from this app's stored data.</>}
                    wont={<>Tell the running app. {CAVEAT}</>}
                    confirmLabel="Delete key"
                    onConfirm={() => void this.deletion.confirm()}
                    onCancel={() => this.deletion.cancel()}
                />
            </section>
        );
    }
}
