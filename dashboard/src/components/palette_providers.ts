import type { AppRow, GlobalEntityRow, StorageRow } from '@protocol';
import { appPath, entityPath } from '../hrefs';
import { actionsFor, type AppAction } from '../views/app_detail_model';
import { displayEntityId } from '../views/entities_model';
import { matchRange, type PaletteProvider, type PaletteResult } from './palette_model';

/** Max results per group, so empty/short queries stay scannable */
const LIMIT = 8;

export interface PaletteNav {
    /** Navigate to `path`; if `focusSelector` is given, scroll to / focus that row once it renders */
    go(path: string, focusSelector?: string): void;
}

const rowSel = (key: string) => `[data-row-key="${key.replace(/["\\]/g, '\\$&')}"]`;

function limited<T>(items: Iterable<T>, pick: (t: T) => PaletteResult | undefined): PaletteResult[] {
    const out: PaletteResult[] = [];
    for (const i of items) {
        const r = pick(i);
        if (r && out.push(r) >= LIMIT) break;
    }
    return out;
}

export const appsProvider = (apps: () => AppRow[], nav: PaletteNav): PaletteProvider => ({
    id: 'apps', title: 'Apps',
    search: q => limited(apps(), a =>
        matchRange(a.id, q) || matchRange(a.name, q)
            ? { id: `app:${a.id}`, label: a.id, sublabel: a.state, run: () => nav.go(appPath(a.id)) }
            : undefined),
});

export const entitiesProvider = (rows: () => GlobalEntityRow[], nav: PaletteNav): PaletteProvider => ({
    id: 'entities', title: 'Entities',
    search: q => limited(rows(), r => {
        const label = displayEntityId(r);
        if (!matchRange(label, q) && !(r.name && matchRange(r.name, q))) return undefined;
        return {
            id: `entity:${r.key}`, label, sublabel: r.app,
            run: () => nav.go(entityPath(r.key)),
        };
    }),
});

/** `<app>/<key>` for every non-internal storage key of every app */
export const storageProvider = (rows: () => Record<string, StorageRow[]>, nav: PaletteNav): PaletteProvider => ({
    id: 'storage', title: 'Storage keys',
    search: q => limited(
        Object.entries(rows()).flatMap(([appId, rs]) => rs.filter(r => !r.internal).map(r => ({ appId, key: r.key }))),
        ({ appId, key }) => matchRange(`${appId}/${key}`, q)
            ? { id: `storage:${appId}/${key}`, label: `${appId}/${key}`, sublabel: 'storage key', run: () => nav.go(appPath(appId, 'storage'), rowSel(key)) }
            : undefined),
});

/** Everything the palette knows per action: its label verb, and whether it interrupts a running app (so asks first) */
export const ACTION_INFO: Record<AppAction, { verb: string; needsConfirm: boolean }> = {
    restart: { verb: 'Restart', needsConfirm: false },
    stop: { verb: 'Stop', needsConfirm: true },
    start: { verb: 'Start', needsConfirm: false },
};

/** "Restart <app>" etc. `request` decides about confirmation and execution. */
export const actionsProvider = (apps: () => AppRow[], request: (appId: string, action: AppAction) => void): PaletteProvider => ({
    id: 'actions', title: 'Actions',
    search: q => limited(
        apps().flatMap(a => actionsFor(a).map(action => ({ id: a.id, action }))),
        ({ id, action }) => matchRange(`${ACTION_INFO[action].verb} ${id}`, q)
            ? { id: `action:${action}:${id}`, label: `${ACTION_INFO[action].verb} ${id}`, sublabel: 'app action', run: () => request(id, action) }
            : undefined),
});
