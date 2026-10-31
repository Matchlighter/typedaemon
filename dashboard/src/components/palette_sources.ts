import type { StorageRow } from '@protocol';
import { autorun, makeAutoObservable, observable, runInAction } from 'mobx';
import { focusRowWhenReady } from '../hooks/focus_row';
import { ConfirmedAction } from '../stores/confirmed_action';
import type { ConnectionStore, TopicSubscription } from '../stores/connection_store';
import type { RouteStore } from '../stores/route_store';
import type { AppAction } from '../views/app_detail_model';
import { ACTION_INFO, actionsProvider, appsProvider, entitiesProvider, storageProvider, type PaletteNav } from './palette_providers';
import type { PaletteProvider } from './palette_model';

/** Actions that interrupt a running app ask first */
export const needsConfirm = (a: AppAction) => ACTION_INFO[a].needsConfirm;

/**
 * Data behind the app-wide palette. Subscribes (apps, entities, one storage topic per app) only while the palette is
 * open, so it holds no topic open while closed. Also owns the app-action flow (`action`: confirmation and failure).
 */
export class PaletteSources {
    /** App actions: `confirming` is the one awaiting the user's confirmation */
    readonly action = new ConfirmedAction<{ appId: string; action: AppAction }>({
        call: ({ appId, action }) => this.conn.call(`app.${action}`, { id: appId }),
        failure: ({ appId, action }, message) => `Couldn't ${action} ${appId}: ${message}`,
        closeOnConfirm: true,
    });

    private apps: TopicSubscription<'apps'> | undefined = undefined;
    private entities: TopicSubscription<'entities'> | undefined = undefined;
    private storage = observable.map<string, TopicSubscription<'appStorage'>>();
    private stopWatch: (() => void) | undefined = undefined;
    private cancelFocus: (() => void) | undefined = undefined;

    constructor(private conn: ConnectionStore, private route: RouteStore) {
        makeAutoObservable<PaletteSources, any>(this, { conn: false, route: false, action: false, stopWatch: false, cancelFocus: false, apps: observable.ref, entities: observable.ref, storage: false }, { autoBind: true });
    }

    private nav: PaletteNav = {
        go: (path, focus) => {
            this.cancelFocus?.();
            this.route.navigate(path);
            if (focus) this.cancelFocus = focusRowWhenReady(focus);
        },
    };

    readonly providers: PaletteProvider[] = [
        appsProvider(() => this.apps?.data?.apps ?? [], this.nav),
        actionsProvider(() => this.apps?.data?.apps ?? [], (appId, action) => this.request(appId, action)),
        entitiesProvider(() => this.entities?.data?.rows ?? [], this.nav),
        storageProvider(() => {
            const out: Record<string, StorageRow[]> = {};
            for (const [id, sub] of this.storage) if (sub.data) out[id] = sub.data.rows;
            return out;
        }, this.nav),
    ];

    setOpen(isOpen: boolean) {
        if (isOpen) this.activate(); else this.deactivate();
    }

    private activate() {
        if (this.stopWatch) return;
        this.apps = this.conn.subscribe('apps');
        this.entities = this.conn.subscribe('entities');
        // One storage subscription per app, kept in step with the app list
        this.stopWatch = autorun(() => {
            const ids = new Set(this.apps?.data?.apps.map(a => a.id));
            runInAction(() => {
                for (const [id, sub] of this.storage) if (!ids.has(id)) { sub.dispose(); this.storage.delete(id); }
                for (const id of ids) if (!this.storage.has(id)) this.storage.set(id, this.conn.subscribe('appStorage', { id }));
            });
        });
    }

    private deactivate() {
        this.stopWatch?.();
        this.stopWatch = undefined;
        this.apps?.dispose(); this.entities?.dispose();
        this.apps = this.entities = undefined;
        for (const sub of this.storage.values()) sub.dispose();
        this.storage.clear();
    }

    /** Run now, or ask first when destructive */
    request(appId: string, action: AppAction) {
        this.action.dismiss();
        if (needsConfirm(action)) this.action.request({ appId, action });
        else void this.action.run({ appId, action });
    }

    /** Topics the results come from have not delivered their first snapshot yet */
    get loading() {
        return !!this.apps && !this.apps.data || !!this.entities && !this.entities.data;
    }
}
