import { mdiCubeOutline, mdiDotsHorizontal, mdiRadioboxMarked, mdiTextLong, mdiViewGridOutline } from '@mdi/js';
import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteStore } from './stores/route_store';
import { System } from './views/System';
import { Logs } from './views/Logs';
import { Apps } from './views/Apps';
import { AppRoute } from './views/AppRoute';
import { Entities } from './views/Entities';
import { Overview } from './views/Overview';
import { Plugins } from './views/Plugins';
import { More } from './views/More';

/**
 * Route registry. A route = first hash segment (`#/apps/lights/logs` -> key `apps`; the view reads the rest
 * from `route.segments` / `route.query`).
 */
export interface RouteDef {
    key: string;
    label: string;
    /** Show in nav. Dev/internal routes omit it. */
    nav?: boolean;
    /** Show directly in the phone bottom bar (others go under "More") */
    phone?: boolean;
    /** MDI path shown on the phone bottom bar */
    icon?: string;
    render: (route: RouteStore) => ReactNode;
}

/** Only referenced behind `import.meta.env.DEV`, so production builds drop it and the gallery chunk with it */
function galleryRoute(): RouteDef {
    const Gallery = lazy(() => import('./views/ComponentGallery').then(m => ({ default: m.ComponentGallery })));
    return { key: '_components', label: 'Components', render: () => <Suspense fallback={null}><Gallery /></Suspense> };
}

export const routes: RouteDef[] = [
    { key: 'overview', label: 'Overview', nav: true, phone: true, icon: mdiViewGridOutline, render: () => <Overview /> },
    {
        key: 'apps', label: 'Apps', nav: true, phone: true, icon: mdiCubeOutline,
        // `#/apps` = list; `#/apps/<id>[/<tab>]` = detail, or the Apps list with the leftovers modal for an app that left the config (keyed by id so switching apps resubscribes)
        render: ({ segments: [, id, tab] }) => id ? <AppRoute key={id} id={id} tab={tab} /> : <Apps />,
    },
    {
        key: 'entities', label: 'Entities', nav: true, phone: true, icon: mdiRadioboxMarked,
        // `#/entities` = list; `#/entities/<row key>` = list + that entity's detail panel
        render: ({ segments: [, id] }) => <Entities selected={id} />,
    },
    {
        key: 'plugins', label: 'Plugins', nav: true,
        // `#/plugins` = list; `#/plugins/<id>` = list + that plugin's inline detail panel
        render: ({ segments: [, id] }) => <Plugins selected={id} />,
    },
    { key: 'logs', label: 'Logs', nav: true, phone: true, icon: mdiTextLong, render: () => <Logs /> },
    { key: 'system', label: 'System', nav: true, render: () => <System /> },
    { key: 'more', label: 'More', render: () => <More /> },
    // Dev-only: component sheet. Components add themselves via `*.gallery.tsx` files.
    ...(import.meta.env.DEV ? [galleryRoute()] : []),
];

/** The phone bar's overflow entry */
export const MORE_ICON = mdiDotsHorizontal;

export const navRoutes = routes.filter(r => r.nav);
