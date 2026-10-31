import { store, with_meta_components } from '@matchlighter/meta_components';
import { dash } from '../format';
import { appHref, pluginHref } from '../hrefs';
import type { PluginRow } from '@protocol';
import { observer } from 'mobx-react';
import { Component, Fragment, lazy, Suspense } from 'react';
import { app } from '../app';
import { ListStates } from '../components/ListStates';
import { RelativeTime } from '../components/RelativeTime';
import { StateBadge } from '../components/StateBadge';
import { Flash } from '../stores/flash';
import { TopicStore } from '../stores/topic_store';
import '../styles/plugins.css';
import { pluginBadge, sortPlugins } from './plugins_model';


/** One plugin card. A state change (eg a broker dropping and coming back) flashes it. */
@with_meta_components
@observer
class PluginCard extends Component<{ row: PluginRow; selected?: boolean }> {
    @store flash = new Flash(() => pluginBadge(this.props.row).state, 1200);

    componentDidUpdate() { this.flash.check(); }

    render() {
        const { row, selected } = this.props;
        const cls = ['card', 'plugin-card', this.flash.active && 'flash', selected && 'selected'].filter(Boolean).join(' ');
        return (
            <section className={cls} data-plugin={row.id} aria-current={selected || undefined}>
                <div className="plugin-card-head">
                    <span className="plugin-card-title">
                        <a className="mono" href={pluginHref(row.id)}>{row.id}</a>
                        <span className="plugin-card-type">type {row.type}</span>
                    </span>
                    <StateBadge {...pluginBadge(row)} />
                </div>
                <dl className="plugin-card-kv">
                    <dt>Target</dt><dd className="mono">{dash(row.target)}</dd>
                    <dt>Since</dt><dd><RelativeTime at={row.since} /></dd>
                    {row.summary?.map(s => <Fragment key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></Fragment>)}
                    <dt>Log level</dt><dd className="mono">{dash(row.logLevel)}</dd>
                    <dt>Used by</dt>
                    <dd className="mono">
                        {row.usedBy?.length
                            ? row.usedBy.map((id, i) => <span key={id}>{i > 0 && ', '}<a href={appHref(id)}>{id}</a></span>)
                            : dash(undefined)}
                    </dd>
                </dl>
            </section>
        );
    }
}

/** Detail panel is its own chunk (log viewer + JSON tree) */
const PluginDetailPanel = lazy(() => import('./PluginDetailPanel'));

/** `#/plugins` = card grid; `#/plugins/<id>` = grid + that plugin's detail panel (lazy subroute) */
@with_meta_components
@observer
export class Plugins extends Component<{ selected?: string }> {
    @store plugins = new TopicStore(app.connection, 'plugins');

    render() {
        const { data, error } = this.plugins;
        const rows = sortPlugins(data?.plugins ?? []);
        const { selected } = this.props;
        const selectedRow = selected ? rows.find(r => r.id === selected) : undefined;
        return (
            <>
                <div className="page-title"><h1>Plugins</h1></div>
                <ListStates
                    status={this.plugins.listStatus}
                    isEmpty={rows.length === 0}
                    empty={{ title: 'No plugins configured', hint: 'Declare plugins in the TypeDaemon config file; they show up here as soon as it is saved.' }}
                    error={{ title: "Couldn't load plugins", detail: error }}
                    syncingLabel="Syncing plugins…"
                >
                    <div className="plugin-grid">{rows.map(r => <PluginCard key={r.id} row={r} selected={r.id === selected} />)}</div>
                    {selectedRow && <Suspense fallback={null}><PluginDetailPanel key={selectedRow.id} row={selectedRow} /></Suspense>}
                    {selected && !selectedRow && <p className="note">No such plugin: "{selected}" is not in the config.</p>}
                </ListStates>
                <p className="note">Plugins are declared in the TypeDaemon config file. Add or remove them there — this page reflects changes live.</p>
            </>
        );
    }
}
