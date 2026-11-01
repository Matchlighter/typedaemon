
import { captureExceptionWithSourceMaps, configureSentry } from "./sentry";
import { isHaConnectionLost } from "../plugins/home_assistant/errors";

import { AsyncLocalStorage } from "async_hooks";
import chalk from "chalk";
import deep_eql from "deep-eql";
import * as fs from "fs";
import moment from "moment-timezone";
import * as path from "path";
import { TypedEmitter } from "tiny-typed-emitter";
import { whyIsNodeStillRunning } from 'why-is-node-still-running';

import { MultiMap } from "@matchlighter/common_library/data/multimap";
import { deep_get } from "@matchlighter/common_library/deep/index";

import { LifecycleHelper } from "../common/lifecycle_helper";
import { cloneTree, DeepReadonly, fileExists, operationsDirectory, resolveSourceFile, timeoutPromise, watchFile } from "../common/util";

import { controlSocketPath } from "../common/control_socket";
import { saveAppRegistry, saveGeneratedTsconfig } from "../common/generate_tsconfig";
import { Plugin } from "../plugins/base";
import { Application } from "../runtime/application";
import { internal_sleep } from "../util";
import { AppLifecycle, ApplicationInstance } from "./application_instance";
import { ConfigMerger, Configuration, NormalizedConfiguration, defaultConfig, readConfigFile } from "./config";
import { AppConfigMerger, AppConfiguration, defaultAppConfig } from "./config_app";
import { PluginConfigMerger, PluginConfiguration, defaultPluginConfig } from "./config_plugin";
import { ControlServer } from "./control_server";
import { startDashboardListener, type DashboardListener } from "../dashboard/listener";
import { CrossCallStore } from "./cross_call";
import { current } from "./current";
import { logTap, type LogSource } from "./log_tap";
import { ExtendedLoger, LogLevel, ORIGINAL_CONSOLE, createDomainLogger, setFallbackLogger } from "./logging";
import { AppNamespace } from "./managed_apps";
import { appDirectory, environmentsDirectory, persistenceFile } from "./app_paths";
import { assertOrphan, destroyOrphan, listOrphanIds, recordRemoval } from "./orphan_apps";
import { installConfigDependencies } from "./packages";
import { SharedStorages } from "./persistent_storage";
import { registerPluginManifests } from "../plugins/manifest";
import { PluginInstance } from "./plugin_instance";
import { ReplOptions, startRepl } from "./repl";

export const CurrentHypervisor = new AsyncLocalStorage<Hypervisor>()

type ConfigWatchHandler<T> = (newConfig: T, oldConfig: T) => void;

const CONFIG_FILE_NAMES = /^typedaemon(_config)?\.(js|ts|json|ya?ml)$/;

export type HypervisorEvents = {
    app_lifecycle: (app: ApplicationInstance, event: AppLifecycle) => void;
    plugin_lifecycle: (plugin: PluginInstance, event: AppLifecycle) => void;
    /** An app picked up resumables its previous run suspended (`methods`: their names) */
    app_resumed: (app: ApplicationInstance, methods: string[]) => void;
    /** An app's runtime stop override was set/cleared */
    app_override_changed: (id: string) => void;
    /** An orphan was cleaned up (the set of orphans changed) */
    orphans_changed: () => void;
}

/** Log source of the hypervisor itself (what the dashboard calls "system") */
const HYPERVISOR_LOG_SOURCE: LogSource = { kind: 'system', id: 'hypervisor' };

export class Hypervisor extends TypedEmitter<HypervisorEvents> {
    constructor(private options: {
        working_directory: string,
        configFile?: string,
        no_watching?: boolean,
    }) {
        super();
        // Built-in plugins' internal key prefixes must be known even when their plugin is not configured (and so never loaded)
        registerPluginManifests();
    }

    private _state: "running" | "shutting_down" = "running";
    get state() { return this._state }

    get working_directory() { return this.options.working_directory }
    get operations_directory() { return operationsDirectory(this.working_directory) }

    protected cleanupTasks = new LifecycleHelper();

    private _currentConfig: NormalizedConfiguration;
    get currentConfig() {
        return this._currentConfig as DeepReadonly<typeof this._currentConfig>;
    }

    private _configFile: string | undefined;
    /** Path of the loaded config file; undefined before it is loaded */
    get configFile() { return this._configFile }

    private _rawConfig: DeepReadonly<Partial<Configuration>> | undefined;
    /** An app's config exactly as the config file gives it (before defaults and normalization); undefined if the file has no such app */
    rawAppConfig(id: string): DeepReadonly<Partial<AppConfiguration>> | undefined {
        return this._rawConfig?.apps?.[id];
    }

    getConfigEntry<T>(entry: string) {
        return deep_get(this.currentConfig, entry.split('.'));
    }

    private config_watches = new MultiMap<string, ConfigWatchHandler<any>>();
    watchConfigEntry<T>(entry: string, handler: ConfigWatchHandler<T>) {
        this.config_watches.add(entry, handler);
        return () => {
            this.config_watches.delete(entry, handler);
        }
    }

    getAndWatchConfigEntry<T>(entry: string, handler: ConfigWatchHandler<T>) {
        const curcfg = this.getConfigEntry(entry);
        handler(curcfg, null);
        return this.watchConfigEntry(entry, handler);
    }

    private _logger: ExtendedLoger = createDomainLogger({
        level: "info",
        domain: chalk.cyan`Hypervisor`,
        source: HYPERVISOR_LOG_SOURCE,
    });
    get logger() { return this._logger }

    logMessage(level: LogLevel, ...rest) {
        this.logger.logMessage(level, rest);
    }

    private updateLogConfiguration(cfg: Configuration['logging']) {
        let sys_file = cfg.system_file;

        this._logger?.close();

        this._logger = createDomainLogger({
            level: cfg.system,
            domain: chalk.cyan`Hypervisor`,
            file: path.resolve(this.working_directory, sys_file),
            source: HYPERVISOR_LOG_SOURCE,
        });

        setFallbackLogger(
            createDomainLogger({
                domain: chalk.yellow("???"),
                file: path.resolve(this.working_directory, sys_file),
                source: { kind: 'system', id: 'unknown' },
            })
        );
    }

    sharedStorages: SharedStorages;
    crossCallStore: CrossCallStore;
    controlServer: ControlServer;
    dashboardListener: DashboardListener;

    async start() {
        return await CurrentHypervisor.run(this, () => {
            this._start();
        })
    }

    private sigint_count = 0;
    private sigterm_count = 0;

    async _start() {
        this.logMessage("lifecycle", "Starting");

        this.logMessage("info", "Loading Config");
        await this.findAndLoadConfig();

        this.getAndWatchConfigEntry("logging", (v) => this.updateLogConfiguration(v));
        this.getAndWatchConfigEntry("location.timezone", (tz: string) => moment.tz.setDefault(tz || undefined));

        this.getAndWatchConfigEntry("tsconfig", async (v) => {
            this.logMessage("debug", "Writing generated tsconfig.json");
            await saveGeneratedTsconfig(this)
        })

        this.getAndWatchConfigEntry("apps", async () => {
            this.logMessage("debug", "Writing generated app registry");
            await saveAppRegistry(this)
        })

        configureSentry(this.currentConfig.sentry);

        await this.startControlServer();
        await this.startDashboard();

        process.on('SIGINT', async () => {
            if (this.sigint_count == 0) {
                this.logMessage("info", "SIGINT received. Shutting down...");
                this.sigint_count += 1;
                startShutdownTimer();

                try {
                    await this.shutdown();
                    this._logger.info('Done')
                    await internal_sleep(500);
                    // await new Promise(accept => this._logger.info('Done', accept))
                } catch (ex) {
                    console.error("Error while shutting down; Forcing", ex)
                }
                process.exit(0);
            } else if (this.sigint_count == 1) {
                ORIGINAL_CONSOLE.log("SIGINT received again. Send again to force immediate shutdown.")
            } else {
                process.exit(504);
            }
        });

        process.on('SIGTERM', async () => {
            if (this.sigterm_count == 0) {
                this.logMessage("info", "SIGTERM received. Shutting down...");
                this.sigint_count += 1;
                startShutdownTimer();

                await this.shutdown();
                this._logger.info('Done')
                await internal_sleep(500);
                // await new Promise(accept => this._logger.info('Done', accept))
                process.exit(0);
            } else {
                this.logMessage("info", "SIGTERM received again. Killing...");
                process.exit(504);
            }
        });

        process.on("uncaughtException", (err, origin) => {
            const app = current.application;
            if (app) {
                console.error("Uncaught error in application")
                console.error(err, err?.stack, origin)
            } else {
                console.error("Uncaught error in TypeDaemon")
                console.error(err, err?.stack, origin)
                // this.shutdown();
            }
            captureExceptionWithSourceMaps(err);
        })

        process.on("unhandledRejection", (err: any, origin) => {
            if (isHaConnectionLost(err)) {
                // A request was in flight when the HA socket dropped; the plugin reconnects on its own
                console.warn("Unhandled rejection: Home Assistant connection lost");
                return;
            }

            const app = current.application;
            if (app) {
                if (app.state == "dead" || app.state == "stopped") {
                    // Downgrade level of the error if it came in after death.
                    // TODO Investigate such cases
                    console.debug(`Unhandled rejection in ${app.state} application`)
                    console.debug(err, err?.stack, origin)
                } else {
                    console.error(`Unhandled rejection in application`)
                    console.error(err, err?.stack, origin)
                }
            } else {
                console.error("Unhandled rejection in TypeDaemon")
                console.error(err, err?.stack, origin)
                // this.shutdown();
            }
            captureExceptionWithSourceMaps(err);
        })

        this.logMessage("info", "Starting Plugins");
        this.pluginInstances.on("instance_lifecycle", (instance, levent) => {
            this.emit("plugin_lifecycle", instance, levent);
        });
        const proms = this.pluginInstances.sync(this.currentConfig.plugins || {});

        await timeoutPromise(10000, Promise.allSettled(proms), () => {
            this.logMessage("warn", `Plugins failed to start within 10s`)
        });

        // let loaded = false;
        // // TODO Support optional plugins?
        // const all_settled = Promise.allSettled(proms).then(() => { loaded = true });
        // while (true) {
        //     await Promise.any([all_settled, internal_sleep(10000)]);
        //     if (!loaded) {
        //         this.logMessage("warn", `Plugins not started after 10s`)
        //     } else {
        //         break;
        //     }
        // }
        this.watchConfigEntry("plugins", () => this.pluginInstances.sync(this.currentConfig.plugins));

        if (this.state != 'running') return;

        const shared_storage_dir = path.join(this.operations_directory, "shared_storage");
        await fs.promises.mkdir(shared_storage_dir, { recursive: true });
        this.sharedStorages = new SharedStorages(shared_storage_dir);
        await this.sharedStorages.initialize();

        this.crossCallStore = new CrossCallStore(this);
        await this.crossCallStore.load();

        await this.syncConfigDependencies();
        this.watchConfigEntry("dependencies", () => this.syncConfigDependencies());

        this.logMessage("info", "Starting Apps");
        this.appInstances.on("instance_lifecycle", (instance, levent) => {
            this.emit("app_lifecycle", instance, levent);
        });
        this.appInstances.on("override_changed", id => this.emit("app_override_changed", id));
        await this.appInstances.sync(this.currentConfig.apps || {});
        let knownApps = new Set(Object.keys(this.currentConfig.apps || {}));
        this.watchConfigEntry("apps", () => {
            const now = new Set(Object.keys(this.currentConfig.apps || {}));
            const removed = [...knownApps].filter(id => !now.has(id));
            knownApps = now;
            // Dashboard shows when orphans were removed; the directory's mtime alone changes on any touch
            Promise.all(removed.map(id => recordRemoval(this, id))).catch(e => this.logMessage("warn", `Could not record removal of apps: ${e}`)).then(() => this.emit("orphans_changed"));
            return this.appInstances.sync(this.currentConfig.apps);
        });
    }

    /** Install pre-installed packages (`dependencies` config) into the config root's node_modules */
    private async syncConfigDependencies() {
        try {
            await installConfigDependencies(this.working_directory, this.currentConfig.dependencies);
        } catch (ex) {
            this.logMessage("error", "Failed to install pre-installed packages", ex);
        }
    }

    async shutdown() {
        this.logMessage("lifecycle", "Stopping");

        this._state = 'shutting_down';

        await this.controlServer?.dispose();
        await this.dashboardListener?.dispose();

        // Shutdown apps
        this.logMessage("info", "Stopping apps");
        await this.appInstances.shutdown();

        await this.crossCallStore.dispose();

        await this.sharedStorages.dispose();

        // Shutdown plugins
        this.logMessage("info", "Stopping plugins");
        await this.pluginInstances.shutdown();

        // Release file watchers and other cleanup
        this.logMessage("info", "Cleaning up");
        await this.cleanupTasks.cleanup();
    }

    protected async findAndLoadConfig() {
        let cfg_file = this.options.configFile;
        if (!cfg_file) {
            const files = await fs.promises.readdir(this.options.working_directory);
            const matched_files = files.map(f => path.resolve(this.options.working_directory, f)).filter(f => path.basename(f).match(CONFIG_FILE_NAMES));
            if (matched_files.length > 1) {
                throw new Error("Multiple config files found!")
            } else if (matched_files.length == 0) {
                throw new Error("Could not find config file!")
            }
            cfg_file = matched_files[0];
        }

        if (!await fileExists(cfg_file)) {
            throw new Error("Given config file does not exist!")
        }

        return await this.readAndWatchConfig(cfg_file)
    }

    protected pluginInstances = new AppNamespace<PluginConfiguration, Plugin, PluginInstance>(this, "Plugin", {
        Host: PluginInstance,
        getInstanceConfig: (id) => this.getConfigEntry(`plugins.${id}`),
        summarizeInstance: (options) => {
            const bits: string[] = [
                chalk.green((options.type)),
            ];

            if ('url' in options) {
                bits.push(chalk`at {green ${options.url}}`)
            }

            return bits.join(' ');
        }
    });
    getPlugin(id: string) { return this.pluginInstances.getInstance(id); }
    /** Currently live plugin instances */
    listPlugins(): PluginInstance[] { return this.pluginInstances.listInstances(); }

    protected appInstances = new AppNamespace<AppConfiguration, Application, ApplicationInstance>(this, "Application", {
        Host: ApplicationInstance,
        getInstanceConfig: (id) => this.getConfigEntry(`apps.${id}`),
        summarizeInstance: (options) => chalk`{green ${options.export}} from {green ${options.source}}`,
    });
    getApplication(id: string) { return this.appInstances.getInstance(id); }
    /** Currently live application instances (mid-restart apps are absent between instances) */
    listApplications(): ApplicationInstance[] { return this.appInstances.listInstances(); }

    /** Run `fn` while no instance of the app can start; `live` is the app's instance if it is up. Use for work on the app's files while it may be down. */
    withApplicationExclusive<R>(id: string, fn: (live: ApplicationInstance | undefined) => Promise<R> | R) { return this.appInstances.withExclusiveAccess(id, fn); }

    /**
     * An instance used only to run an app's destroyers: not registered in the namespace, so nothing else sees it.
     * The app's own logs are about to be deleted, so it logs to the Hypervisor's.
     */
    private transientDestroyInstance(id: string) {
        const { logging } = this.currentConfig;
        return new ApplicationInstance({ id, hypervisor: this, namespace: this.appInstances }, {
            ...defaultAppConfig,
            logging: { file: logging.system_file, level: logging.application, system_level: logging.system },
        });
    }

    /** Apps that left the config but still have an operating directory (see `destroyApplication`) */
    listOrphanApplications() { return listOrphanIds(this); }

    /**
     * Clean up an app that is no longer in the config: run the destroyers it registered (eg remove its entities from HA),
     * then delete its operating directory. Rejects, leaving everything in place, if any destroyer fails or the app is
     * configured/running. Exclusive and symlink-safe. Never touches the app's source or the config.
     */
    async destroyApplication(id: string) {
        this.logMessage("info", `Destroying Application '${id}'`);
        await destroyOrphan(this, id, async () => {
            await this.transientDestroyInstance(id).run_destroyers();
        });
        logTap.drop({ kind: 'app', id });
        this.emit("orphans_changed");
    }

    /** Stop an app until it is started/restarted or the config is next reloaded */
    stopApplication(id: string) { return this.appInstances.stopInstance(id); }
    /** Start an app (clearing a stop override) if not running */
    startApplication(id: string) { return this.appInstances.startInstance(id); }
    /** Re-initialize an app now; also starts a stopped one */
    restartApplication(id: string) { return this.appInstances.restartInstance(id); }
    /** True while an app is stopped by a runtime override (see `stopApplication`) */
    isApplicationStopped(id: string) { return this.appInstances.isStoppedOverride(id); }

    get app_environments_directory() { return environmentsDirectory(this.operations_directory) }

    /** The default operating directory of app `id` (rejects ids that are not a plain directory name) */
    defaultAppOperatingDirectory(id: string) {
        return appDirectory(this.operations_directory, id);
    }

    /** The persisted-storage file of app `id` when it uses the default operating directory */
    defaultAppPersistenceFile(id: string) {
        return persistenceFile(this.defaultAppOperatingDirectory(id));
    }

    private async startDashboard() {
        const { port, token } = this.currentConfig.dashboard ?? {};
        try {
            this.dashboardListener = await startDashboardListener(this, { port, token });
            this.logMessage("info", `Dashboard listening on :${this.dashboardListener.port}`);
        } catch (ex) {
            // Not critical to running apps
            this.logMessage("warn", `Failed to start dashboard on port ${port}:`, ex);
        }
    }

    private async startControlServer() {
        const server = this.controlServer = new ControlServer(controlSocketPath(this.working_directory), this.logMessage.bind(this));

        server.handle("repl", (args: ReplOptions, socket) => startRepl(this, socket, args), { stream: true });

        server.handle("apps.destroyable", async ({ ids }: { ids?: string[] } = {}) => {
            const orphans = await this.listOrphanApplications();
            ids ??= orphans;
            for (let id of ids) {
                assertOrphan(this, id);
                if (!orphans.includes(id)) throw new Error(`No resources found for app '${id}'`);
            }
            return ids.map(id => ({ id, operating_directory: this.defaultAppOperatingDirectory(id) }));
        });

        server.handle("apps.destroy", ({ id }: { id: string }) => this.destroyApplication(id));

        try {
            await server.start();
        } catch (ex) {
            // Not critical to running apps - eg Unix socket paths have a short length limit
            this.logMessage("warn", `Failed to start control socket at ${server.socket_path}. CLI commands that need the Hypervisor will be unavailable:`, ex);
        }
    }

    private async readAndWatchConfig(file: string) {
        const no_watching = this.options.no_watching;

        const _loadConfig = async () => {
            let parsed = await readConfigFile(file);
            this._configFile = file;
            // The merges below reuse (and replace entries of) the parsed objects
            this._rawConfig = cloneTree(parsed);

            const cfg = ConfigMerger.mergeConfigs(defaultConfig, parsed);

            cfg.logging.plugins_file ||= path.join(this.operations_directory, "logs", "plugins", "{plugin}", "%DATE%.log");
            cfg.logging.plugins_file = path.resolve(this.working_directory, cfg.logging.plugins_file);

            cfg.logging.system_file ||= path.join(this.operations_directory, "logs", "%DATE%.log");
            cfg.logging.system_file = path.resolve(this.working_directory, cfg.logging.system_file);

            if (no_watching) {
                cfg.daemon.watch = { app_configs: false, app_source: false, config: false }
            }

            if (cfg.plugins["http"] === undefined) {
                cfg.plugins["http"] = {
                    type: "http",
                }
            }

            // Normalize plugin configs
            for (let [ak, raw_cfg] of Object.entries(cfg.plugins)) {
                const plcfg = PluginConfigMerger.mergeConfigs(defaultPluginConfig, {
                    watch: {
                        config: cfg.daemon.watch?.app_configs,
                    },
                    logging: {
                        level: cfg.logging.system,
                        file: cfg.logging.plugins_file?.replaceAll("{plugin}", ak),
                    }
                }, raw_cfg);

                if (no_watching) {
                    plcfg.watch = { config: false }
                }

                cfg.plugins[ak] = plcfg;
            }

            // Normalize application configs
            for (let [ak, raw_cfg] of Object.entries(cfg.apps)) {
                const appcfg = AppConfigMerger.mergeConfigs(defaultAppConfig, {
                    watch: {
                        config: cfg.daemon.watch?.app_configs,
                        source: cfg.daemon.watch?.app_source,
                    },
                    logging: {
                        file: cfg.logging.applications_file?.replaceAll("{app}", ak),
                        level: cfg.logging.application,
                        system_level: cfg.logging.system,
                    }
                }, raw_cfg);

                appcfg.declared_source = raw_cfg.source;
                const sourcePath = path.resolve(this.working_directory, raw_cfg.source);
                // TODO Allow sourcePath to be GitHub URL
                const resolved = await resolveSourceFile(sourcePath);
                if (resolved) appcfg.source = resolved;

                if (no_watching) {
                    appcfg.watch = { config: false, source: false }
                }

                cfg.apps[ak] = appcfg;
            }

            // console.debug("Loaded Config", cfg)

            const prevConfig = this.currentConfig;
            this._currentConfig = cfg;

            // Runtime stop overrides last only until that app's config entry changes (the "apps" watcher then re-syncs)
            const appIds = new Set([...Object.keys(prevConfig?.apps || {}), ...Object.keys(cfg.apps)]);
            this.appInstances.clearOverrides([...appIds].filter(id => !deep_eql(prevConfig?.apps?.[id], cfg.apps[id])));

            // Apply watchers top-down. Do not run watchers that are removed or added by broader watchers
            const watchedKeys = new Set<string>();
            const initial = new MultiMap<string, ConfigWatchHandler<any>>();
            for (let [k, w] of this.config_watches.items()) {
                watchedKeys.add(k);
                initial.add(k, w);
            }
            const sortedKeys = [...watchedKeys].sort(); //.sort((a, b) => a.split('.').length - b.split('.').length);
            for (let k of sortedKeys) {
                const curSet = this.config_watches.group(k);
                const initialSet = initial.group(k);
                const intersection = new Set([...curSet].filter(x => initialSet.has(x)));

                const oldv = deep_get(prevConfig, k.split('.'));
                const newv = deep_get(cfg, k.split('.'));
                if (!deep_eql(oldv, newv)) {
                    for (let w of intersection) {
                        w(newv, oldv);
                    }
                }
            }
        }

        await _loadConfig();

        if (this.currentConfig.daemon.watch.config) {
            this.logMessage("debug", `Watching config file ${chalk.green(file)}`)
            const watcher = watchFile(file, () => {
                this.logMessage("info", `Reloading Typedaemon Config`)
                _loadConfig()
            });
            this.cleanupTasks.append(() => watcher.close());
        }
    }
}

export class UtilityHypervisor extends Hypervisor {
    async start() {
        await this.findAndLoadConfig()
    }
    async shutdown() {
        await this.cleanupTasks.cleanup();
    }
}

function startShutdownTimer() {
    setTimeout(() => {
        console.error("TypeDaemon would not shutdown. Dumping state and forcing exit.");
        whyIsNodeStillRunning();
        process.exit(503);
    }, 15_000).unref();
}
