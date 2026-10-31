import { store, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { Chip } from '../components/Chip';
import { CopyIconButton } from '../components/CopyIconButton';
import { ListStates } from '../components/ListStates';
import { TopicStore } from '../stores/topic_store';
import '../styles/http.css';
import { displayPath, fullUrl } from './http_model';
import { inRegistrationOrder } from './keyed_rows';

/** Mock: GET is green, other verbs the accent blue; STATIC stays neutral. */
const methodTone = (m?: string) => (m === 'GET' ? 'ok' : m ? 'run' : undefined);

/**
 * App detail "HTTP" tab. Subscribed for as long as the tab is shown, so an app restart only drops and
 * recreates rows (the app registers its routes again as it starts).
 */
@with_meta_components
@observer
export class AppHttpTab extends Component<{ appId: string }> {
    @store http = new TopicStore(app.connection, 'appHttp', { id: this.props.appId });

    render() {
        const { data, error } = this.http;
        const rows = inRegistrationOrder(data?.rows ?? []);
        return (
            <section>
                <ListStates
                    status={this.http.listStatus}
                    isEmpty={rows.length === 0}
                    empty={{ title: 'No HTTP handlers', hint: 'Routes appear when the app calls this.http.get() or mounts static files.' }}
                    error={{ title: "Couldn't load HTTP handlers", detail: error }}
                    syncingLabel="Syncing HTTP handlers…"
                >
                    <div className="tbl-wrap">
                        <table className="tbl http-table">
                            <thead><tr><th>Method</th><th>Path</th><th>Handler / mount</th><th>URL</th><th className="http-copy" /></tr></thead>
                            <tbody>
                                {rows.map(r => {
                                    const url = fullUrl(r, data?.port, window.location);
                                    return (
                                        <tr key={r.key}>
                                            <td>{r.kind === 'static' ? <Chip>STATIC</Chip> : <Chip tone={methodTone(r.method)}>{r.method}</Chip>}</td>
                                            <td className="mono">{displayPath(r)}</td>
                                            <td className="mono http-handler">{r.handler}</td>
                                            <td className="mono http-url">{url}</td>
                                            <td className="http-copy"><CopyIconButton text={url} label="Copy URL" /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </ListStates>
            </section>
        );
    }
}
