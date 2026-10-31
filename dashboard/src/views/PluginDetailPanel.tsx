import type { PluginRow } from '@protocol';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { JsonViewer } from '../components/JsonViewer';
import { ConfirmedAction } from '../stores/confirmed_action';
import '../styles/plugins.css';
import { LogsView } from './LogsView';
import { with_meta_components } from '@matchlighter/meta_components';

/**
 * Inline detail under the plugin card grid (`#/plugins/<id>`): logs left, resolved config right (secrets hidden
 * by the server), Reconnect in the header. Lazy-loaded by `Plugins`, so the log viewer stays out of the list chunk.
 */
@with_meta_components
@observer
export default class PluginDetailPanel extends Component<{ row: PluginRow }> {
    /** Server rejects when the plugin is not running or cannot reconnect; shown as-is */
    private reconnect = new ConfirmedAction<string>({ call: id => app.connection.call('plugin.reconnect', { id }) });

    render() {
        const { row } = this.props;
        return (
            <section className="card plugin-detail" aria-label={`${row.id} detail`}>
                <header className="plugin-detail-head">
                    <h2>{row.id} <span className="plugin-detail-sub">· detail</span></h2>
                    <button type="button" className="btn" disabled={this.reconnect.busy || row.state !== 'started'}
                        onClick={() => void this.reconnect.run(row.id)}>Reconnect</button>
                </header>
                <ActionError error={this.reconnect.error} />
                <div className="plugins-split">
                    <section className="plugins-logs" aria-label="Logs">
                        <h3 className="lbl">Logs</h3>
                        <LogsView viewKey={`plugin:${row.id}`} sources={[{ kind: 'plugin', id: row.id }]} emptyHint="Lines appear here as the plugin logs." />
                    </section>
                    <section className="plugins-config" aria-label="Config">
                        <h3 className="lbl">Config · read-only</h3>
                        <JsonViewer value={row.config} scope={`plugin-config/${row.id}`} />
                        <p className="note">Secrets hidden · edit in the config file.</p>
                    </section>
                </div>
            </section>
        );
    }
}
