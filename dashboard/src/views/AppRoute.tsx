import { mount_effect, store, with_meta_components } from '@matchlighter/meta_components';
import { observable, reaction } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { AppsCrumb } from '../components/AppsCrumb';
import { ListStates } from '../components/ListStates';
import { RouteStore } from '../stores/route_store';
import { TopicStore } from '../stores/topic_store';
import { AppDetailView, appLoadCopy } from './AppDetail';
import { Apps } from './Apps';
import { OrphanModal } from './OrphanModal';

export interface AppRouteProps {
    id: string;
    /** Tab key from the route */
    tab?: string;
}

/**
 * `#/apps/<id>[/<tab>]`: the app's page, or, if the id is an app that left the config and has leftovers, the Apps list with that orphan's leftovers modal open over it
 * (tab `cleanup`: confirmation up). Once seen as an orphan it stays the Apps page, also after the cleanup removed its leftovers.
 */
@with_meta_components
@observer
export class AppRoute extends Component<AppRouteProps> {
    @store orphan = new TopicStore(app.connection, 'orphan', { id: this.props.id });

    private wasOrphan = observable.box(false);

    /** Latch: once the id shows leftovers it stays the Apps page, also after the cleanup removed them */
    @mount_effect
    latchOrphan() {
        return reaction(() => this.orphan.data?.leftovers, leftovers => { if (leftovers) this.wasOrphan.set(true) }, { fireImmediately: true });
    }

    render() {
        const { id, tab } = this.props;
        const { data, error } = this.orphan;
        if (data && (data.leftovers || this.wasOrphan.get())) return <Apps>{data.leftovers && <OrphanModal id={id} tab={tab} leftovers={data.leftovers} />}</Apps>;
        if (data) return <AppDetailView id={id} tab={tab} />;
        return (
            <>
                <AppsCrumb />
                <ListStates
                    status={this.orphan.listStatus}
                    {...appLoadCopy(error)}
                />
            </>
        );
    }
}
