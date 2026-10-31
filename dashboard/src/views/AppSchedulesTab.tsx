import { store, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ListStates } from '../components/ListStates';
import { ScheduleHead, ScheduleRow } from '../components/ScheduleRow';
import { TopicStore } from '../stores/topic_store';
import '../styles/schedule.css';
import { inRegistrationOrder } from './keyed_rows';

/**
 * App detail "Schedules" tab. Subscribed for as long as the tab is shown, so an app restart only drops and
 * recreates rows. Countdowns tick from the shared clock; rows update when a schedule fires.
 */
@with_meta_components
@observer
export class AppSchedulesTab extends Component<{ appId: string }> {
    @store schedules = new TopicStore(app.connection, 'appSchedules', { id: this.props.appId });

    render() {
        const { data, error } = this.schedules;
        const rows = inRegistrationOrder(data?.rows ?? []);
        return (
            <section className="sched-list">
                <ListStates
                    status={this.schedules.listStatus}
                    isEmpty={rows.length === 0}
                    empty={{ title: 'No schedules', hint: 'Callbacks registered with @schedule, run_every, run_in or run_at show here with their next and last fire.' }}
                    error={{ title: "Couldn't load schedules", detail: error }}
                    syncingLabel="Syncing schedules…"
                >
                    <ScheduleHead />
                    {rows.map(r => (
                        <ScheduleRow key={r.key} expression={r.expression} kind={r.kind} method={r.method}
                            nextAt={r.nextAt} lastAt={r.lastAt} lastResult={r.lastResult} lastDurationMs={r.lastDurationMs} />
                    ))}
                </ListStates>
            </section>
        );
    }
}
