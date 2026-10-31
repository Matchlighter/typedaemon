import type { AppDetail } from '@protocol';
import type { ReactNode } from 'react';
import { visibleTab, type TabBarItem } from '../components/TabBar';
import { appHref } from '../hrefs';
import { isSettling } from './app_detail_model';
import { AppConfigTab } from './AppConfigTab';
import { AppEntitiesTab } from './AppEntitiesTab';
import { AppHttpTab } from './AppHttpTab';
import { AppLogsTab } from './AppLogsTab';
import { AppOverviewTab } from './AppOverviewTab';
import { AppResumablesTab } from './AppResumablesTab';
import { AppSchedulesTab } from './AppSchedulesTab';
import { AppStorageTab } from './AppStorageTab';

/**
 * App detail tab registry. TO ADD A TAB: replace its entry's `render` (and `count`/`flag`) here; nothing else changes.
 * Order = tab bar order. Tab = `#/apps/<id>/<key>`; `overview` is the default (`#/apps/<id>`).
 */
export interface AppTab {
    key: string;
    label: string;
    /** Number shown beside the label; undefined while the server has no data for it yet */
    count?: (d: AppDetail) => number | undefined;
    /** Warning text beside the count (e.g. `+1 unlinked`) */
    flag?: (d: AppDetail) => string | undefined;
    render: (d: AppDetail) => ReactNode;
}

export const appTabs: AppTab[] = [
    { key: 'overview', label: 'Overview', render: d => <AppOverviewTab detail={d} /> },
    { key: 'logs', label: 'Logs', render: d => <AppLogsTab appId={d.row.id} /> },
    {
        key: 'entities', label: 'Entities', render: d => <AppEntitiesTab appId={d.row.id} />,
        count: d => d.counts.entities,
        flag: d => d.counts.unlinkedEntities ? `+${d.counts.unlinkedEntities} unlinked` : undefined,
    },
    { key: 'storage', label: 'Storage', render: d => <AppStorageTab appId={d.row.id} />, count: d => d.counts.storage },
    { key: 'resumables', label: 'Resumables & Scripts', render: d => <AppResumablesTab appId={d.row.id} />, count: d => d.counts.resumables },
    { key: 'schedules', label: 'Schedules', render: d => <AppSchedulesTab appId={d.row.id} />, count: d => d.counts.schedules },
    { key: 'http', label: 'HTTP', render: d => <AppHttpTab appId={d.row.id} />, count: d => d.counts.http },
    { key: 'config', label: 'Config', render: d => <AppConfigTab appId={d.row.id} /> },
];

/** The tab to show for a route segment; unknown/missing -> overview */
export const visibleTabKey = (segment: string | undefined) => visibleTab(appTabs, segment);

/** The tab bar entries for this app's state */
export const tabItems = (d: AppDetail): TabBarItem[] =>
    appTabs.map(t => {
        // counts are unknown while (re)starting: placeholder instead of 0, and no unlinked warning
        if (isSettling(d.row.state)) return { key: t.key, label: t.label, count: t.count ? '…' : undefined };
        return { key: t.key, label: t.label, count: t.count?.(d), flag: t.flag?.(d) };
    });
