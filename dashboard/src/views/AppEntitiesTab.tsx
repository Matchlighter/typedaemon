import { store, with_meta_components } from '@matchlighter/meta_components';
import { observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { EntityDeleteButton, EntityDeleteDialog } from '../components/EntityDeleteDialog';
import { EntityTable } from '../components/EntityTable';
import { ListStates } from '../components/ListStates';
import { Segmented } from '../components/Segmented';
import { entityHref, haEntityHref } from '../hrefs';
import { TopicStore } from '../stores/topic_store';
import '../styles/entities.css';
import { PluginStaleNote } from '../components/PluginStaleNote';
import { downPlugins } from './plugins_model';
import { entityDeletion } from './entity_deletion';
import { displayEntityId, ENTITY_SEGMENT_LABEL, ENTITY_SEGMENTS, entitySegmentCounts, filterEntities, type EntitySegment } from './entities_model';


/**
 * App detail "Entities" tab. Subscribed for as long as the tab is shown, so an app restart only drops and recreates
 * rows; the filter (component state) and scroll position are untouched.
 */
@with_meta_components
@observer
export class AppEntitiesTab extends Component<{ appId: string }> {
    @store entities = new TopicStore(app.connection, 'appEntities', { id: this.props.appId });

    @store plugins = new TopicStore(app.connection, 'plugins');
    private ui = observable({ segment: 'all' as EntitySegment, query: '' });
    private deletion = entityDeletion(this.props.appId);

    render() {
        const { data, error } = this.entities;
        const counts = entitySegmentCounts(data?.rows ?? []);
        const rows = filterEntities(data?.rows ?? [], { segment: this.ui.segment, query: this.ui.query });
        const total = data?.rows.length ?? 0;
        const down = downPlugins(this.plugins.data);
        const haBaseUrl = app.system.data?.haBaseUrl;
        return (
            <section className="ents card ents-card">
                <div className="ents-bar">
                    <Segmented label="Filter by link status" value={this.ui.segment} onChange={v => { this.ui.segment = v }}
                        options={ENTITY_SEGMENTS.map(value => ({ value, label: ENTITY_SEGMENT_LABEL[value], count: counts[value] }))} />
                    <input type="search" className="input-pill" placeholder="Filter entities" aria-label="Filter entities"
                        value={this.ui.query} onChange={e => { this.ui.query = e.target.value }} />
                </div>
                <ActionError error={this.deletion.error} />
                <PluginStaleNote plugins={new Set(rows.filter(r => down.has(r.plugin)).map(r => r.plugin))} />
                <ListStates
                    status={this.entities.listStatus}
                    isEmpty={rows.length === 0}
                    empty={this.ui.query.trim()
                        ? { title: 'No matching entities', hint: 'Nothing matches the current filter.' }
                        : this.ui.segment === 'all'
                            ? { title: 'No entities', hint: 'Entities this app registers with Home Assistant show up here while it runs.' }
                            : { title: `No ${this.ui.segment} entities`, hint: 'Nothing matches the current filter.' }}
                    error={{ title: "Couldn't load entities", detail: error }}
                    syncingLabel="Syncing entities…"
                >
                    <EntityTable rows={rows.map(r => ({
                        key: r.key, entityId: displayEntityId(r), name: r.name, domain: r.domain, state: r.state, linked: r.linked,
                        stale: down.has(r.plugin), autoClean: r.autoClean, persistState: r.persistState,
                        detailHref: entityHref(`${this.props.appId}/${r.key}`),
                        ha: r.entityId ? haEntityHref(r.entityId, haBaseUrl) : undefined,
                        action: !r.linked && <EntityDeleteButton deletion={this.deletion} row={r} />,
                    }))} />
                </ListStates>
                <p className="note ents-foot">
                    {this.ui.segment === 'unlinked'
                        ? <>Unlinked: exists in HA / <code>auto_clean</code> registry, but no running app registers it. TypeDaemon removes them on the next start; delete them now here.</>
                        : <>Showing {rows.length} of {total} · state updates live</>}
                </p>
                <EntityDeleteDialog deletion={this.deletion} />
            </section>
        );
    }
}
