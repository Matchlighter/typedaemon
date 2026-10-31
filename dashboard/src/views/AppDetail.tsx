import { mount_effect, store, with_meta_components } from '@matchlighter/meta_components';
import type { AppDetail } from '@protocol';
import { mdiEyeOutline, mdiRefresh } from '@mdi/js';
import { reaction } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { AppsCrumb } from '../components/AppsCrumb';
import { ActionError } from '../components/ActionError';
import { Chip } from '../components/Chip';
import { CopyIconButton } from '../components/CopyIconButton';
import { TabBar } from '../components/TabBar';
import { appHref, errorLogsHref } from '../hrefs';
import { ErrorPanel } from '../components/ErrorPanel';
import { Icon } from '../components/Icon';
import { ListStates } from '../components/ListStates';
import { RelativeTime } from '../components/RelativeTime';
import { StateBadge } from '../components/StateBadge';
import { ConfirmedAction } from '../stores/confirmed_action';
import { RouteStore } from '../stores/route_store';
import { TopicStore } from '../stores/topic_store';
import '../styles/appdetail.css';
import { actionsFor, appBadge, showOverrideNotice, type AppAction } from './app_detail_model';
import { sortPlugins } from './plugins_model';
import { blockedOn } from './system_model';
import { appTabs, tabItems, visibleTabKey } from './app_tabs';

/** Error and syncing copy of an app page that has no data yet (also used by `AppRoute`, which waits for the orphan topic first) */
export const appLoadCopy = (detail: string | undefined) => ({ error: { title: "Couldn't load app", detail }, syncingLabel: 'Syncing app…' });

const ACTION_LABEL: Record<AppAction, string> = { restart: 'Restart', stop: 'Stop', start: 'Start' };

/** The startup error panel, with the plugins' live state (subscribed only while the app is dead) and the cross-app calls waiting on this app beside it */
@with_meta_components
@observer
class FailurePanel extends Component<{ appId: string; failure: NonNullable<AppDetail['failure']>; logsHref: string }> {
    @store plugins = new TopicStore(app.connection, 'plugins');

    render() {
        const { failure, logsHref } = this.props;
        return <ErrorPanel phase={failure.phase} message={failure.message} frames={failure.frames} codeFrame={failure.codeFrame}
            logsHref={logsHref} plugins={this.plugins.data && sortPlugins(this.plugins.data.plugins)}
            blockedCalls={app.system.data && blockedOn(app.system.data.crossCalls, this.props.appId)} />;
    }
}

export interface AppDetailViewProps {
    id: string;
    /** Tab key from the route; unknown/missing = overview */
    tab?: string;
}

/**
 * App detail page: header (live state, actions), startup error panel when dead, tab bar, active tab.
 * The tab comes from the route and the subscription stays up across restarts, so tab and scroll survive them.
 * Tabs live in `app_tabs.tsx`.
 */
@with_meta_components
@observer
export class AppDetailView extends Component<AppDetailViewProps> {
    @store detail = new TopicStore(app.connection, 'app', { id: this.props.id });

    /** Header actions run at once (the palette is what asks before stopping) */
    private action = new ConfirmedAction<AppAction>({ call: a => app.connection.call(`app.${a}`, { id: this.props.id }) });

    /** Phone top bar: back chevron + the app's name (the header's own heading is hidden there) */
    @mount_effect
    nameInChrome() {
        const href = RouteStore.href('/apps');
        let release: (() => void) | undefined;
        const stop = reaction(() => this.detail.data?.row.name, name => {
            release?.();
            release = name ? app.chrome.set({ title: name, backHref: href }) : undefined;
        }, { fireImmediately: true });
        return () => { stop(); release?.() };
    }

    private header(detail: AppDetail) {
        const { row } = detail;
        const busy = this.action.busy;
        const dead = row.state === 'dead';
        const exportName = detail.instanceOf.split('#')[1];
        return (
            <header className="appd-head">
                <div className="appd-id">
                    <AppsCrumb />
                    <div className="appd-title">
                        <h1>{row.name}</h1>
                        <StateBadge {...appBadge(row, this.action.running)} />
                        {row.state === 'started' && <span className="appd-sub">up <RelativeTime at={row.since} /></span>}
                        {dead && (
                            <>
                                <span className="appd-sub">died <RelativeTime at={row.since} /></span>
                                {detail.watching && <span className="appd-sub appd-watching"><Icon path={mdiEyeOutline} size={14} />Watching — restarts on next save</span>}
                            </>
                        )}
                    </div>
                    <div className="appd-meta">
                        <span className="mono">{row.id}</span>
                        {row.kind && <Chip mono>{row.kind}</Chip>}
                        {exportName && <Chip mono>{`export ${exportName}`}</Chip>}
                        <span className="mono appd-source">{row.source}</span>
                        <CopyIconButton text={row.source} label="Copy source path" />
                    </div>
                </div>
                {/* mock: secondary Stop first, primary Restart right-most */}
                <div className="appd-actions">
                    {dead && <a className="btn appd-logs-link" href={errorLogsHref(row.id, detail.failure?.logId)}>Open logs</a>}
                    {[...actionsFor(row, this.action.running)].reverse().map(a => (
                        <button key={a} type="button" disabled={busy}
                            className={`btn${a === 'restart' || (dead && a === 'start') ? ' btn-primary' : ''}${dead && a === 'stop' ? ' appd-phone-hide' : ''}`}
                            onClick={() => void this.action.run(a)}>
                            {a === 'restart' && <Icon path={mdiRefresh} size={16} />}
                            {dead && a === 'restart' ? 'Restart now' : ACTION_LABEL[a]}
                        </button>
                    ))}
                </div>
                <ActionError error={this.action.error} />
                {showOverrideNotice(row) && (
                    <div className="appd-override" role="status">
                        Stopped from the dashboard — resets on next config reload. Start it to run it now.
                    </div>
                )}
            </header>
        );
    }

    render() {
        const { data, error } = this.detail;
        const tabKey = visibleTabKey(this.props.tab);
        const tab = appTabs.find(t => t.key === tabKey)!;
        return (
            <>
                {!data && <AppsCrumb />}
                <ListStates
                    status={this.detail.listStatus}
                    {...appLoadCopy(error)}
                >
                    {data && (
                        <div className="appd">
                            {this.header(data)}
                            {data.failure && <FailurePanel appId={data.row.id} failure={data.failure} logsHref={errorLogsHref(data.row.id, data.failure.logId)} />}
                            <TabBar label="App sections" tabs={tabItems(data)} current={tabKey} hrefFor={k => appHref(data.row.id, k)} />
                            <div className="appd-panel" data-tabpanel={tabKey}>{tab.render(data)}</div>
                        </div>
                    )}
                </ListStates>
            </>
        );
    }
}
