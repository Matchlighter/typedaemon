import { store, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { CopyPathButton } from '../components/CopyPathButton';
import { JsonViewer } from '../components/JsonViewer';
import { ListStates } from '../components/ListStates';
import { TopicStore } from '../stores/topic_store';
import '../styles/appconfig.css';
import { defaultAnnotations, fileLocation } from './config_model';

/**
 * App detail "Config" tab: the app's effective config (after defaults and merges), read-only. Edits are made in the
 * config file; saving it reloads the app, which arrives here as a fresh snapshot.
 */
@with_meta_components
@observer
export class AppConfigTab extends Component<{ appId: string }> {
    @store config = new TopicStore(app.connection, 'appConfig', { id: this.props.appId });

    render() {
        const { data, error } = this.config;
        const location = data && fileLocation(data);
        return (
            <section className="cfg card">
                <ListStates
                    status={this.config.listStatus}
                    error={{ title: "Couldn't load config", detail: error }}
                    syncingLabel="Syncing config…"
                >
                    {data && <>
                        <div className="cfg-head">
                            <span className="note"><strong className="cfg-title">Resolved config</strong> read-only · after defaults &amp; merges</span>
                            {location && data.file && (
                                <span className="cfg-file">
                                    <code className="cfg-path mono">{location}</code>
                                    <CopyPathButton path={data.file!} />
                                </span>
                            )}
                        </div>
                        <JsonViewer value={data.config} scope={`config/${this.props.appId}`} annotations={defaultAnnotations(data.defaults)} />
                        <p className="note">Edit in VS Code — saving the file reloads this app.</p>
                    </>}
                </ListStates>
            </section>
        );
    }
}
