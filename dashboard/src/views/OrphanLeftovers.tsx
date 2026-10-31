import { with_meta_components } from '@matchlighter/meta_components';
import type { OrphanLeftovers } from '@protocol';
import { observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { Chip } from '../components/Chip';
import { EntityRow as EntityRowView } from '../components/EntityRow';
import { InternalKeysToggle } from '../components/InternalKeysToggle';
import { ListStates } from '../components/ListStates';
import { StorageKeyRow } from '../components/StorageKeyRow';
import { formatBytes, plural } from '../format';
import { entityHref } from '../hrefs';
import '../styles/appdetail.css';
import '../styles/appstorage.css';
import '../styles/entities.css';
import '../styles/orphan.css';
import { displayEntityId, filterEntities } from './entities_model';
import { rowValue, visibleStorageRows } from './storage_model';

export interface OrphanLeftoversViewProps {
    id: string;
    leftovers: OrphanLeftovers;
}

/** What a removed app left behind, grouped by type: operating directory, entities in HA, stored keys, pending destroyers. Read-only. */
@with_meta_components
@observer
export class OrphanLeftoversView extends Component<OrphanLeftoversViewProps> {
    private ui = observable({ showInternal: false });

    private scopeOf = (key: string) => `orphan/${this.props.id}/${key}`;
    private loaderFor = (key: string) => () => app.connection.call('storage.value', { app: this.props.id, key });

    render() {
        const { id, leftovers: l } = this.props;
        const entities = filterEntities(l.entities, {});
        const { rows, internal } = visibleStorageRows(l.storage, this.ui.showInternal);
        return (
            <>
                <section className="orphan-section" data-section="dir">
                    <h3>Operating directory</h3>
                    <div><code className="mono orphan-path">{l.dir.path}</code> <span className="appd-muted">{formatBytes(l.dir.bytes)} in {plural(l.dir.files, 'file', 'files')}</span></div>
                </section>
                <section className="orphan-section" data-section="entities">
                    <h3>Entities still in Home Assistant <span className="cnt">{entities.length}</span></h3>
                    <ListStates status="live" isEmpty={entities.length === 0}
                        empty={{ title: 'No entities', hint: 'Only entities the app registered with auto_clean are remembered.' }}>
                        <div className="ents-list">
                            {entities.map(r => (
                                <EntityRowView key={r.key} entityId={displayEntityId(r)} detailHref={entityHref(`${id}/${r.key}`)} name={r.name} state={r.state} linked={false}
                                    owner={{ id, orphan: true }} autoClean={r.autoClean} persistState={r.persistState} />
                            ))}
                        </div>
                    </ListStates>
                </section>
                <section className="orphan-section" data-section="storage">
                    <div className="orphan-section-head">
                        <h3>Stored keys <span className="cnt">{l.storage.length}</span></h3>
                        <InternalKeysToggle count={internal} shown={this.ui.showInternal} onToggle={() => { this.ui.showInternal = !this.ui.showInternal }} />
                    </div>
                    <ListStates status="live" isEmpty={rows.length === 0}
                        empty={{ title: 'No stored keys', hint: 'The app stored nothing.' }}>
                        <div className="stor-list">
                            {rows.map(r => (
                                <StorageKeyRow key={r.key} storageKey={r.key} scope={this.scopeOf(r.key)} value={rowValue(r)}
                                    loader={this.loaderFor(r.key)} size={r.size} writtenAt={r.writtenAt} internal={r.internal} />
                            ))}
                        </div>
                    </ListStates>
                </section>
                <section className="orphan-section" data-section="destroyers">
                    <h3>Pending destroyers <span className="cnt">{l.destroyers.length}</span></h3>
                    <ListStates status="live" isEmpty={l.destroyers.length === 0}
                        empty={{ title: 'No pending destroyers', hint: 'Nothing the app created elsewhere needs releasing.' }}>
                        <ul className="orphan-destroyers">
                            {l.destroyers.map(d => (
                                <li key={d.uuid}><Chip mono>{d.type}</Chip> <code className="mono">{JSON.stringify(d.options)}</code></li>
                            ))}
                        </ul>
                        <p className="appd-muted">Destroyers run, in this order, when the orphan is cleaned up.</p>
                    </ListStates>
                </section>
            </>
        );
    }
}
