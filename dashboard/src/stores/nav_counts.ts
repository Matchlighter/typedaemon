import { makeAutoObservable } from 'mobx';
import type { ConnectionStore } from './connection_store';
import { TopicStore } from './topic_store';
import { segmentCounts } from '../views/apps_model';

/** What a nav tab shows beside its label */
export interface NavBadges {
    /** Neutral count bubble */
    count?: number;
    /** Red count bubble (things needing attention, e.g. dead apps) */
    errors?: number;
}

/**
 * Permanent, shared handles behind the nav-tab badges (so they show on every page): app/plugin totals, the
 * number of dead apps and the server-provided `counts` (entities). Views keep their own subscriptions; this adds one per topic.
 */
export class NavCounts {
    private apps: TopicStore<'apps'>;
    private plugins: TopicStore<'plugins'>;
    private counts: TopicStore<'counts'>;

    constructor(conn: ConnectionStore) {
        this.apps = new TopicStore(conn, 'apps');
        this.plugins = new TopicStore(conn, 'plugins');
        this.counts = new TopicStore(conn, 'counts');
        makeAutoObservable<NavCounts, 'apps' | 'plugins' | 'counts'>(this, { apps: false, plugins: false, counts: false });
    }

    activate() {
        const stops = [this.apps, this.plugins, this.counts].map(s => s.activate());
        return () => stops.forEach(stop => stop());
    }

    /** Badges per route key; a tab without data yet (or without badges) has none */
    get badges(): Record<string, NavBadges> {
        const out: Record<string, NavBadges> = {};
        const apps = this.apps.data?.apps;
        if (apps) out.apps = { count: apps.length, errors: segmentCounts(apps).dead };
        const plugins = this.plugins.data?.plugins;
        if (plugins) out.plugins = { count: plugins.length };
        // Server-side totals: the full entities list is only subscribed to by the Entities page
        const counts = this.counts.data;
        if (counts?.entities != null) out.entities = { count: counts.entities };
        return out;
    }
}
