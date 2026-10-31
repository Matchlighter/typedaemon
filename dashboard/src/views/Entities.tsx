import { store, with_meta_components } from '@matchlighter/meta_components';
import type { GlobalEntityRow } from '@protocol';
import { observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { EntityDeleteButton, EntityDeleteDialog } from '../components/EntityDeleteDialog';
import { EntityTable } from '../components/EntityTable';
import { ListStates } from '../components/ListStates';
import { Segmented } from '../components/Segmented';
import { EntityPanel } from './EntityDetail';
import { appHref, entityHref } from '../hrefs';
import { TopicStore } from '../stores/topic_store';
import '../styles/entities.css';
import { displayEntityId, ENTITY_SEGMENT_LABEL, ENTITY_SEGMENTS, entityFacets, filterEntities, orphanUnlinkedHint, type EntityFilter, type FacetOption } from './entities_model';
import { PluginStaleNote } from '../components/PluginStaleNote';
import { downPlugins } from './plugins_model';
import { entityDeletion } from './entity_deletion';

function FacetSelect({ label, all, value, options, onChange }: { label: string; all: string; value: string; options: FacetOption[]; onChange: (v: string) => void }) {
    return (
        <select className="input-pill" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
            <option value="">{all}</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.value}{o.orphan && ' (orphan)'}</option>)}
        </select>
    );
}

/** Entities page: every entity of every app (and orphan) in one filterable, live list. Answers "who owns sensor.foo?". */
@with_meta_components
@observer
export class Entities extends Component<{ /** `GlobalEntityRow.key` whose detail panel is open */ selected?: string }> {
    @store entities = new TopicStore(app.connection, 'entities');
    @store plugins = new TopicStore(app.connection, 'plugins');
    private deletion = entityDeletion();
    private filter = observable<Required<EntityFilter>>({ segment: 'all', app: '', domain: '', query: '' });

    render() {
        const { data, error } = this.entities;
        const all = data?.rows ?? [];
        const f = this.filter;
        const facets = entityFacets(all, f);
        const rows = filterEntities(all, f);
        const down = downPlugins(this.plugins.data);
        const selected = this.props.selected;
        const orphanHint = orphanUnlinkedHint(all);
        const filtered = f.segment !== 'all' || !!f.app || !!f.domain || !!f.query.trim();
        return (
            <>
                <div className="page-title">
                    <h1>Entities</h1>
                    <div className="ents-controls">
                        <input type="search" className="input-pill ents-search" placeholder="Who owns sensor.foo?" aria-label="Filter by entity id"
                            value={f.query} onChange={e => { f.query = e.target.value }} />
                        <FacetSelect label="Filter by app" all="All apps" value={f.app} options={facets.apps} onChange={v => { f.app = v }} />
                        <FacetSelect label="Filter by domain" all="All domains" value={f.domain} options={facets.domains} onChange={v => { f.domain = v }} />
                        <Segmented label="Filter by link status" value={f.segment} onChange={v => { f.segment = v }}
                            options={ENTITY_SEGMENTS.map(value => ({ value, label: ENTITY_SEGMENT_LABEL[value], count: facets.segments[value], warn: value === 'unlinked' }))} />
                    </div>
                </div>
                <ActionError error={this.deletion.error} />
                <PluginStaleNote plugins={new Set(rows.filter(r => down.has(r.plugin)).map(r => r.plugin))} />
                <div className={`ents-split${this.props.selected ? ' ents-has-detail' : ''}`}>
                <section className="ents card ents-card">
                <ListStates
                    status={this.entities.listStatus}
                    isEmpty={rows.length === 0}
                    empty={filtered
                        ? { title: 'No matching entities', hint: 'Nothing matches the current filters.' }
                        : { title: 'No entities', hint: 'Entities apps register with Home Assistant show up here while they run.' }}
                    error={{ title: "Couldn't load entities", detail: error }}
                    syncingLabel="Syncing entities…"
                >
                    <EntityTable virtual label="Entities" columns={{ owner: true, domain: false, flags: false }} rows={rows.map(r => ({
                        key: r.key, entityId: displayEntityId(r), name: r.name, domain: r.domain, state: r.state, linked: r.linked,
                        selected: r.key === selected, stale: down.has(r.plugin), detailHref: entityHref(r.key),
                        owner: { id: r.app, orphan: r.orphan, href: appHref(r.app) },
                        // An orphan's app isn't running, so `entity.delete` can't reach it: its cleanup (all of its leftovers at once) is on its page
                        action: !r.linked && !r.orphan && <EntityDeleteButton deletion={this.deletion} row={r} />,
                    }))} />
                </ListStates>
                <p className="note ents-foot">
                    Showing {rows.length} of {all.length}{orphanHint && <> · <span className="ents-orphan-hint">{orphanHint}</span></>}
                </p>
                </section>
                {/* keyed by entity so switching resubscribes */}
                {this.props.selected && <EntityPanel key={this.props.selected} id={this.props.selected} />}
                </div>
                <EntityDeleteDialog deletion={this.deletion} />
            </>
        );
    }
}
