import type { LogSourceRef } from '@protocol';
import { mount_effect, store, with_meta_components } from '@matchlighter/meta_components';
import { reaction } from 'mobx';
import { observer } from 'mobx-react';
import { Component, type ReactNode } from 'react';
import { app } from '../app';
import { LogsPanel } from '../components/LogsPanel';
import { TopicStore } from '../stores/topic_store';
import { LOG_BUFFER } from './logs_model';
import { logsViewState } from './logs_view_state';

export interface LogsViewProps {
    /** Key of the persisted filters/pause/open stacks, so they survive leaving and returning (eg `app:lights`) */
    viewKey: string;
    /** Sources to show; every source when omitted */
    sources?: LogSourceRef[];
    /** Offer a filter by source kind (for views that mix sources) */
    sourceFilter?: boolean;
    /** Open on the line the route asks for: `?focus=<log id>`, or the newest error for `?focus=error` (or an id that has left the buffer) */
    routeFocus?: boolean;
    emptyHint?: string;
    /** Page heading, shown in the status row */
    title?: ReactNode;
    /** One source's tab: single card, no source column, starts on the user channel (see `LogsPanel.scoped`) */
    scoped?: boolean;
}

/**
 * Log viewer for any set of sources: history, then live tail (both channels; the panel filters).
 * Filters and open stacks are kept per `viewKey` across visits.
 */
@with_meta_components
@observer
export class LogsView extends Component<LogsViewProps> {
    @store logs = new TopicStore(app.connection, 'logs', { sources: this.props.sources, limit: LOG_BUFFER });

    private get view() { return logsViewState(this.props.viewKey, this.props.scoped ? { channel: 'user' } : undefined); }

    @mount_effect
    focusFromRoute() {
        if (!this.props.routeFocus) return;
        let done = false;
        const stop = reaction(
            () => (app.route.query.focus ? this.logs.data?.entries : undefined),
            entries => {
                if (!entries) { done = false; return; }
                if (done) return;
                const focus = app.route.query.focus!;
                const id = /^\d+$/.test(focus) ? Number(focus) : undefined;
                done = (id !== undefined && this.view.jumpToLog(entries, id)) || this.view.jumpToLastError(entries);
            },
            { fireImmediately: true },
        );
        return stop;
    }

    /** A pause is for the visit: coming back follows the tail again */
    @mount_effect
    followOnLeave() {
        return () => this.view.resume();
    }

    render() {
        const { data, error } = this.logs;
        return <LogsPanel rows={data?.entries ?? []} state={this.view} status={this.logs.listStatus} error={error} emptyHint={this.props.emptyHint} sourceFilter={this.props.sourceFilter} title={this.props.title} scoped={this.props.scoped} />;
    }
}
