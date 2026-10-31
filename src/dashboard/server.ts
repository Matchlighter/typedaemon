import express, { type Express } from "express";
import * as fs from "fs";
import type { Server } from "http";
import * as path from "path";
import { WebSocketServer } from "ws";
import { TD_VERSION_PRECISE, __package_dir } from "../common/util";
import { ActionRegistry } from "./actions";
import { AdminChannel } from "./channel";
import { appEntitiesTopic } from "./app_entities_topic";
import { countsTopic } from "./counts_topic";
import { entitiesTopic } from "./entities_topic";
import { entityTopic } from "./entity_topic";
import { hypervisorEntitySource } from "./hypervisor_entity_source";
import { hypervisorEntitiesSource } from "./hypervisor_entities_source";
import { hypervisorAppEntitiesSource, type AppEntitiesHost } from "./hypervisor_app_entities_source";
import { appStorageTopic } from "./app_storage_topic";
import { hypervisorAppStorageSource, type AppStorageHost } from "./hypervisor_app_storage_source";
import { appResumablesTopic } from "./app_resumables_topic";
import { hypervisorAppResumablesSource, type AppResumablesHost } from "./hypervisor_app_resumables_source";
import { appConfigTopic } from "./app_config_topic";
import { hypervisorAppConfigSource, type AppConfigHost } from "./hypervisor_app_config_source";
import { appHttpTopic } from "./app_http_topic";
import { hypervisorAppHttpSource, type AppHttpHost } from "./hypervisor_app_http_source";
import { appSchedulesTopic } from "./app_schedules_topic";
import { schedulesTopic } from "./schedules_topic";
import { resumablesTopic } from "./resumables_topic";
import { hypervisorResumablesSource, type ResumablesHost } from "./hypervisor_resumables_source";
import { hypervisorSchedulesSource, type SchedulesHost } from "./hypervisor_schedules_source";
import { hypervisorAppSchedulesSource, type AppSchedulesHost } from "./hypervisor_app_schedules_source";
import { logsTopic } from "./logs_topic";
import { hypervisorLogsSource, type LogsHost } from "./hypervisor_logs_source";
import { appTopic } from "./app_topic";
import { appsTopic } from "./apps_topic";
import { lifecycleTopic } from "./lifecycle_topic";
import { hypervisorLifecycleSource, type LifecycleHost } from "./hypervisor_lifecycle_source";
import { pluginsTopic } from "./plugins_topic";
import { hypervisorPluginsSource, reconnectPlugin, type PluginsHost } from "./hypervisor_plugins_source";
import { hypervisorAppDetailSource } from "./hypervisor_app_detail_source";
import { hypervisorAppsSource, type AppsHost } from "./hypervisor_apps_source";
import type { Hypervisor } from "../hypervisor/hypervisor";
import { hypervisorOrphanSource, type OrphanSourceHost } from "./hypervisor_orphan_source";
import { orphanTopic } from "./orphan_topic";
import { hypervisorSystemSource, type SystemHost } from "./hypervisor_system_source";
import { systemTopic } from "./system_topic";
import { TopicRegistry } from "./topics";
import type { DashboardAuthorizer } from "./auth";

/** Per-mount registries. Topics: type in `TopicMap`; one-shot commands (`call` messages): type in `ActionMap` (both in ./protocol.ts). */
interface Registries {
    topics: TopicRegistry;
    actions: ActionRegistry;
}

/** What the dashboard needs from the hypervisor (public API only) */
export type DashboardHost = AppsHost & AppEntitiesHost & AppStorageHost & AppResumablesHost & AppSchedulesHost & SchedulesHost & ResumablesHost & AppHttpHost & AppConfigHost & LogsHost & PluginsHost & OrphanSourceHost & SystemHost & LifecycleHost & Pick<Hypervisor, 'stopApplication' | 'startApplication' | 'restartApplication'>;

/** Every topic and action, each over its own narrow source seam. Add new ones here */
function registerAll({ topics, actions }: Registries, hypervisor: DashboardHost, lifecycle: ReturnType<typeof hypervisorLifecycleSource>) {
    const entities = hypervisorAppEntitiesSource(hypervisor);
    const allEntities = hypervisorEntitiesSource(hypervisor, entities);
    const schedules = hypervisorAppSchedulesSource(hypervisor);
    const storage = hypervisorAppStorageSource(hypervisor);
    const system = hypervisorSystemSource(hypervisor);
    const resumables = hypervisorAppResumablesSource(hypervisor);
    const orphan = hypervisorOrphanSource(hypervisor);
    return [
        topics.register('lifecycle', lifecycleTopic(lifecycle)),
        topics.register('system', systemTopic({ version: TD_VERSION_PRECISE, nodeVersion: process.versions.node, startedAt: STARTED_AT }, system)),
        topics.register('apps', appsTopic(hypervisorAppsSource(hypervisor))),
        topics.register('plugins', pluginsTopic(hypervisorPluginsSource(hypervisor))),
        actions.register('plugin.reconnect', ({ id }) => reconnectPlugin(hypervisor, id)),
        topics.register('app', appTopic(hypervisorAppDetailSource(hypervisor))),
        topics.register('appEntities', appEntitiesTopic(entities)),
        topics.register('entities', entitiesTopic(allEntities)),
        topics.register('counts', countsTopic({ entities: { count: async () => (await allEntities.list()).length, onChange: cb => allEntities.onChange(cb) } })),
        topics.register('entity', entityTopic(hypervisorEntitySource(hypervisor, allEntities))),
        actions.register('entity.delete', ({ app, key }) => entities.remove(app, key)),
        topics.register('appStorage', appStorageTopic(storage)),
        actions.register('storage.value', ({ app, key }) => storage.value(app, key)),
        actions.register('storage.delete', ({ app, key }) => storage.remove(app, key)),
        topics.register('orphan', orphanTopic(orphan)),
        actions.register('orphan.cleanup', ({ id }) => orphan.cleanup(id)),
        actions.register('sharedStorage.value', ({ store, key }) => system.value(store, key)),
        topics.register('appResumables', appResumablesTopic(resumables)),
        actions.register('resumable.cancel', ({ app, key }) => resumables.cancel(app, key)),
        actions.register('resumable.discard', ({ app, key }) => resumables.discard(app, key)),
        actions.register('script.cancel', ({ app, script, run }) => resumables.cancelRun(app, script, run)),
        actions.register('crossCall.cancel', ({ uuid }) => system.cancelCall(uuid)),
        topics.register('resumables', resumablesTopic(hypervisorResumablesSource(hypervisor, resumables))),
        topics.register('appSchedules', appSchedulesTopic(schedules)),
        topics.register('schedules', schedulesTopic(hypervisorSchedulesSource(hypervisor, schedules))),
        topics.register('appHttp', appHttpTopic(hypervisorAppHttpSource(hypervisor))),
        topics.register('logs', logsTopic(hypervisorLogsSource(hypervisor))),
        topics.register('appConfig', appConfigTopic(hypervisorAppConfigSource(hypervisor))),
        actions.register('app.restart', ({ id }) => hypervisor.restartApplication(id)),
        actions.register('app.stop', ({ id }) => hypervisor.stopApplication(id)),
        actions.register('app.start', ({ id }) => hypervisor.startApplication(id)),
    ];
}

export const DASHBOARD_DIST = path.join(__package_dir, 'dist', 'dashboard');
const STARTED_AT = Date.now() - process.uptime() * 1000;

/**
 * Serves the built dashboard at `/` and the admin websocket at `/ws` (the client resolves `ws` relative to its
 * own URL, so HA Ingress prefixes work). Returns a disposer.
 */
export function mountDashboard(server: Server, app: Express, hypervisor: DashboardHost, authorize?: DashboardAuthorizer): () => void {
    const registries: Registries = { topics: new TopicRegistry(), actions: new ActionRegistry() };
    const { topics, actions } = registries;
    // Collects history from the start, so it outlives any one subscription
    const lifecycle = hypervisorLifecycleSource(hypervisor);
    const offTopics = [lifecycle.dispose, ...registerAll(registries, hypervisor, lifecycle)];

    if (authorize) {
        app.use((req, resp, next) => {
            if (authorize(req)) {
                const cookie = authorize.sessionCookie(req);
                if (cookie) resp.setHeader('Set-Cookie', cookie);
                return next();
            }
            resp.status(403).type('text').send('Forbidden');
        });
    }

    if (fs.existsSync(DASHBOARD_DIST)) {
        app.use(express.static(DASHBOARD_DIST));
    } else {
        app.get('/', (_req, resp) => {
            resp.status(503).type('text').send('Dashboard not built. Run `yarn build` (or `yarn --cwd dashboard build`).');
        });
    }

    const wss = new WebSocketServer({ noServer: true });
    const onUpgrade = (req, socket, head) => {
        const pathname = new URL(req.url, 'http://x').pathname;
        if (pathname !== '/ws') {
            // Unhandled upgrades would hang open forever; drop them unless another listener may claim them
            if (server.listenerCount('upgrade') <= 1) socket.destroy();
            return;
        }
        if (authorize && !authorize(req, { checkOrigin: true })) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            new AdminChannel(topics, {
                send: raw => ws.send(raw),
                onMessage: cb => ws.on('message', data => cb(data.toString())),
                onClose: cb => ws.on('close', cb),
            }, actions);
        });
    };
    server.on('upgrade', onUpgrade);

    return () => {
        offTopics.forEach(off => off());
        server.off('upgrade', onUpgrade);
        wss.clients.forEach(c => c.terminate());
        wss.close();
    };
}
