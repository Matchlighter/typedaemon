import { mdiDeleteOutline } from '@mdi/js';
import { Component } from 'react';
import type { GallerySection } from '../gallery';
import { Icon } from './Icon';
import { StorageKeyRow, StorageTableHead } from './StorageKeyRow';

const T = Date.now();
const del = <button type="button" className="icon-btn" aria-label="Delete key"><Icon path={mdiDeleteOutline} size={16} /></button>;

class Demo extends Component<{}, { n: number; internal: boolean }> {
    state = { n: 0, internal: false };
    render() {
        const { n, internal } = this.state;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => this.setState({ n: n + 1 })}>Simulate delta on "counter"</button>
                    <label><input type="checkbox" checked={internal} onChange={e => this.setState({ internal: e.target.checked })} /> Show internal</label>
                </div>
                <StorageKeyRow storageKey="scenes" value={{ evening: { brightness: 40, transition: 5 }, morning: { brightness: 90 } }} writtenAt={T - 9 * 60_000} action={del} />
                <StorageKeyRow storageKey="counter" value={n + 41} writtenAt={T - 3_000} changedAt={n || undefined} action={del} />
                <StorageKeyRow storageKey="last_greeting" value="hello from a rather long string value that might need to be truncated at some point" writtenAt={T - 3 * 3600_000} action={del} />
                {internal && <StorageKeyRow storageKey="__typedaemon:resume" internal value={{ pending: [] }} writtenAt={T - 86400_000} />}
            </div>
        );
    }
}

const Table = () => (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="skey-table">
            <StorageTableHead />
            <StorageKeyRow layout="table" storageKey="@persistent-last_scene" value="evening" writtenAt={T - 9 * 60_000} changedAt={1} action={del} />
            <StorageKeyRow layout="table" storageKey="@persistent-scene_history" value={Array.from({ length: 48 }, () => 'evening')} writtenAt={T - 9 * 60_000} action={del} />
            <StorageKeyRow layout="table" storageKey="entity_state:scene_mode" value={{ state: 'evening', attrs: { icon: 'mdi:palette', since: '2026-10-18' } }} writtenAt={T - 9 * 60_000} action={del} />
            <StorageKeyRow layout="table" storageKey="_schema_version" internal value={3} writtenAt={T - 12 * 86400_000} action={del} />
        </div>
    </div>
);

export default { title: 'Storage key row', render: () => <><Demo /><h4>Table layout</h4><Table /></> } satisfies GallerySection;
