import { store, with_meta_components } from '@matchlighter/meta_components';
import { mdiContentCopy } from '@mdi/js';
import { observer } from 'mobx-react';
import { Component, type ReactNode } from 'react';
import { formatBytes } from '../format';
import { Flash } from '../stores/flash';
import { scopedPath, sharedJsonViewState } from '../stores/json_view_state';
import '../styles/storage.css';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { copyJson, JsonViewer, type JsonViewerProps } from './JsonViewer';
import { byteSize, inlinePreview } from './json_model';
import { RelativeTime } from './RelativeTime';

export interface StorageKeyRowProps {
    storageKey: string;
    value: unknown;
    /** Loader/state for lazy values; see JsonViewer. */
    loader?: JsonViewerProps['loader'];
    /** Stored size in bytes; defaults to the serialized size of `value` (pass it for lazy placeholders). */
    size?: number;
    /** Epoch ms of last write. */
    writtenAt: number;
    /** Framework-internal key: tagged and dimmed. Whether to list such rows at all is up to the caller. */
    internal?: boolean;
    /** Names this row's JSON viewer in the shared open state (so open nodes persist per key); see `JsonViewer`. */
    scope?: string;
    /** Changes on each live delta for this key (e.g. the delta's timestamp); flashes "changed" for 1.5s. */
    changedAt?: unknown;
    /**
     * `card` (default): bordered card, value always a JSON tree.
     * `table`: divided row of a `.skey-table` (head: `StorageTableHead`); scalars and flat containers as a one-line preview, only nested/lazy values as a tree; chips beside key/time; copy button before `action`.
     */
    layout?: 'card' | 'table';
    /** Trailing slot, e.g. a delete icon button. */
    action?: ReactNode;
}

/** Storage key row (design.md "Storage key row"). */
@with_meta_components
@observer
export class StorageKeyRow extends Component<StorageKeyRowProps> {
    @store flash = new Flash(() => this.props.changedAt);

    componentDidUpdate() { this.flash.check(); }

    render() {
        const p = this.props;
        const changed = this.flash.active;
        const table = p.layout === 'table';
        const preview = table ? inlinePreview(p.value) : null;
        const internalChip = p.internal && <Chip className="skey-internal">internal</Chip>;
        const changedChip = changed && <Chip accent className="skey-changed" role="status">changed</Chip>;
        const cls = ['skey-row', table && 'skey-row-table', p.internal && 'skey-row-internal', changed && 'flash'].filter(Boolean).join(' ');
        const key = <span className="mono skey-key" title={p.storageKey}>{p.storageKey}</span>;
        return (
            <div data-row-key={p.storageKey} className={cls}>
                {table ? <span className="skey-keycell">{key}{internalChip}</span> : key}
                <div className="skey-value">
                    {preview !== null
                        ? <span className="mono skey-preview" title={preview}>{preview}</span>
                        : <JsonViewer value={p.value} loader={p.loader} scope={p.scope} copy={!table} />}
                </div>
                <span className="mono skey-size">{formatBytes(p.size ?? byteSize(p.value))}</span>
                <span className="skey-written"><RelativeTime at={p.writtenAt} />{table && changedChip}</span>
                {!table && <span className="skey-tags">{internalChip}{changedChip}</span>}
                <span className="skey-actions">
                    {table && (
                        <button type="button" className="icon-btn" aria-label={`Copy value of ${p.storageKey}`} title="Copy JSON"
                            onClick={() => void copyJson(p.value, scopedPath(p.scope, '$'), sharedJsonViewState(), p.loader)}>
                            <Icon path={mdiContentCopy} size={16} />
                        </button>
                    )}
                    {p.action}
                </span>
            </div>
        );
    }
}

/** Column header of a `.skey-table` (rows with `layout="table"`) */
export function StorageTableHead() {
    return (
        <div className="skey-head lbl" role="presentation">
            <span>Key</span><span>Value</span><span className="skey-size">Size</span><span>Last write</span><span />
        </div>
    );
}
