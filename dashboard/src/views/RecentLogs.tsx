import { store, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ListStates } from '../components/ListStates';
import { LogLine } from '../components/LogLine';
import { TopicStore } from '../stores/topic_store';
import { toLogEntry } from './logs_model';

/** Lines shown in a preview */
export const RECENT_LOG_LINES = 5;
/** History fetched so that hidden debug lines don't crowd out the lines shown */
const FETCH_LINES = 100;

/** The newest few log lines of one app, live (a preview: the Logs tab has the history, filters and tail control). */
@with_meta_components
@observer
export class RecentLogs extends Component<{ appId: string }> {
    @store logs = new TopicStore(app.connection, 'logs', { sources: [{ kind: 'app', id: this.props.appId }], limit: FETCH_LINES });

    render() {
        const { data, error } = this.logs;
        // Debug noise belongs to the Logs tab
        const rows = (data?.entries ?? []).filter(r => r.level !== 'debug').slice(-RECENT_LOG_LINES);
        return (
            <ListStates
                status={this.logs.listStatus}
                isEmpty={rows.length === 0}
                empty={{ title: 'No log lines yet', hint: 'Lines appear here as the app logs.' }}
                error={{ title: "Couldn't load logs", detail: error }}
                syncingLabel="Syncing logs…"
            >
                <div className="appd-recent-logs">
                    {rows.map(r => <LogLine key={r.id} entry={toLogEntry(r)} hideSource />)}
                </div>
            </ListStates>
        );
    }
}
