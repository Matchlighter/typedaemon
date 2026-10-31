import { store, with_meta_components } from '@matchlighter/meta_components';
import { mdiClose, mdiOpenInNew } from '@mdi/js';
import type { EntityDetail } from '@protocol';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { Chip } from '../components/Chip';
import { domainIcon } from '../components/EntityRow';
import { Icon } from '../components/Icon';
import { JsonViewer } from '../components/JsonViewer';
import { ListStates } from '../components/ListStates';
import { RelativeTime } from '../components/RelativeTime';
import { StateBadge } from '../components/StateBadge';

import { dash } from '../format';
import { appHref, haEntityHref } from '../hrefs';
import { RouteStore } from '../stores/route_store';
import { TopicStore } from '../stores/topic_store';
import '../styles/appdetail.css';
import '../styles/entities.css';
import { PluginStaleNote } from '../components/PluginStaleNote';
import { downPlugins } from './plugins_model';
import { displayEntityId } from './entities_model';

export interface EntityPanelProps {
    /** `GlobalEntityRow.key` */
    id: string;
}

const time = (iso: string | undefined) => iso && !isNaN(Date.parse(iso)) ? <RelativeTime at={Date.parse(iso)} /> : dash(undefined);

/**
 * Detail side panel of the Entities page (`#/entities/<row key>`): one entity's live HA state, attributes, owner and flags (`entity` topic).
 */
@with_meta_components
@observer
export class EntityPanel extends Component<EntityPanelProps> {
    @store entity = new TopicStore(app.connection, 'entity', { id: this.props.id });

    @store plugins = new TopicStore(app.connection, 'plugins');

    private header(e: EntityDetail) {
        return (
            <header className="entp-head">
                <span className="entp-icon"><Icon path={domainIcon(displayEntityId(e))} size={20} /></span>
                <div className="entp-title">
                    <h2 id="entp-title">{e.name || displayEntityId(e)}</h2>
                    {e.name && <span className="mono entp-id">{displayEntityId(e)}</span>}
                </div>
                <a className="icon-btn" href={RouteStore.href('/entities')} aria-label="Close detail" title="Close"><Icon path={mdiClose} size={16} /></a>
            </header>
        );
    }

    private details(e: EntityDetail) {
        const unavailable = e.state == null || !e.linked;
        return (
            <>
                <div className="entp-state">
                    <span className={`entity-state${unavailable ? ' entity-state-muted' : ''}`}>{unavailable ? 'unavailable' : e.state}</span>
                    {e.lastChanged && <span className="entp-changed">changed {time(e.lastChanged)}</span>}
                </div>
                <dl className="appd-kv entp-kv">
                    <dt>Owner</dt>
                    <dd><a className={`mono${e.orphan ? ' entity-owner-orphan' : ''}`} href={appHref(e.app)}>{e.app}{e.orphan ? ' (orphan)' : ''}</a></dd>
                    <dt>Link</dt><dd><StateBadge kind="entity" state={e.linked ? 'linked' : 'unlinked'} /></dd>
                    {(e.autoClean || e.persistState) && (
                        <><dt>Flags</dt><dd className="entity-flags">
                            {e.autoClean && <Chip mono>auto_clean</Chip>}
                            {e.persistState && <Chip mono>persist_state</Chip>}
                        </dd></>
                    )}
                    <dt>Domain</dt><dd className="mono">{e.domain}</dd>
                    <dt>Plugin</dt><dd className="mono">{e.plugin}</dd>
                    <dt>Last updated</dt><dd>{time(e.lastUpdated)}</dd>
                </dl>
            </>
        );
    }

    private attributes(e: EntityDetail) {
        const empty = !e.attributes || Object.keys(e.attributes).length === 0;
        return (
            <section className="entp-attrs" aria-label="Attributes">
                <span className="entp-label">Attributes · live</span>
                {empty
                    ? <p className="note">{e.linked ? 'Home Assistant reports no attributes.' : 'Not in Home Assistant right now, so no attributes.'}</p>
                    : <JsonViewer value={e.attributes} scope={`entity-attrs/${e.key}`} />}
            </section>
        );
    }

    render() {
        const { data, error } = this.entity;
        const down = data && downPlugins(this.plugins.data).has(data.plugin) ? [data.plugin] : [];
        const ha = data?.entityId ? haEntityHref(data.entityId, app.system.data?.haBaseUrl) : undefined;
        return (
            <aside className="card entp" aria-label="Entity detail">
                <ListStates
                    status={down.length && this.entity.listStatus === 'live' ? 'stale' : this.entity.listStatus}
                    error={{ title: "Couldn't load entity", detail: error }}
                    syncingLabel="Syncing entity…"
                >
                    {data && (
                        <>
                            {this.header(data)}
                            <PluginStaleNote plugins={down} />
                            {this.details(data)}
                            {this.attributes(data)}
                            {ha && (
                                <a className="btn entp-ha" {...ha} rel="noopener noreferrer"><Icon path={mdiOpenInNew} size={14} />Open in Home Assistant</a>
                            )}
                        </>
                    )}
                </ListStates>
            </aside>
        );
    }
}
