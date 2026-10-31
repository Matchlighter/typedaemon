import { autorun } from 'mobx';
import { sharedClock } from './stores/clock';
import { ConnectionStore, defaultWsUrl } from './stores/connection_store';
import { NavCounts } from './stores/nav_counts';
import { PageChrome } from './stores/page_chrome';
import { RouteStore } from './stores/route_store';
import { ThemeStore } from './stores/theme_store';
import { TopicStore } from './stores/topic_store';

/** App-wide singletons. Import `app` wherever a store is needed (or build your own in tests). */
const connection = new ConnectionStore({ url: defaultWsUrl() });

export const app = {
    connection,
    /** Permanent, shared `system` handle (header version; views read version / uptime / state / cross-app calls from it instead of subscribing again) */
    system: new TopicStore(connection, 'system'),
    /** Permanent, shared handles behind the nav-tab count badges */
    navCounts: new NavCounts(connection),
    route: new RouteStore(),
    /** Detail views name themselves in the phone top bar through this */
    chrome: new PageChrome(),
    theme: new ThemeStore(),
};

app.system.activate();
app.navCounts.activate();

// Stale connection -> freeze shared clock (countdowns pause, RelativeTime dims).
autorun(() => sharedClock.setPaused(connection.stale));
