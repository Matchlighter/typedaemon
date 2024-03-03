
import fs = require("fs")
import path = require("path")
import deep_eql = require("deep-eql")
import chalk = require("chalk")
import moment = require("moment-timezone")
import { AsyncLocalStorage } from "async_hooks"
import { TypedEmitter } from "tiny-typed-emitter"
import { whyIsNodeStillRunning } from 'why-is-node-still-running'

import { MultiMap } from "@matchlighter/common_library/data/multimap"
import { deep_get } from "@matchlighter/common_library/deep/index"

import { LifecycleHelper } from "../common/lifecycle_helper"
import { DeepReadonly, fileExists, resolveSourceFile, timeoutPromise, watchFile } from "../common/util"

import { saveGeneratedTsconfig } from "../common/generate_tsconfig"
import { Plugin } from "../plugins/base"
import { Application } from "../runtime/application"
import { internal_sleep } from "../util"
import { AppLifecycle, ApplicationInstance } from "./application_instance"
import { ConfigMerger, Configuration, defaultConfig, readConfigFile } from "./config"
import { AppConfigMerger, AppConfiguration, defaultAppConfig } from "./config_app"
import { PluginConfigMerger, PluginConfiguration, defaultPluginConfig } from "./config_plugin"
import { CrossCallStore } from "./cross_call"
import { current } from "./current"
import { ExtendedLoger, LogLevel, ORIGINAL_CONSOLE, createDomainLogger, setFallbackLogger } from "./logging"
import { AppNamespace } from "./managed_apps"
import { SharedStorages } from "./persistent_storage"
import { PluginInstance } from "./plugin_instance"

export const CurrentHypervisor = new AsyncLocalStorage<Hypervisor>()

type ConfigWatchHandler<T> = (newConfig: T, oldConfig: T) => void;

const CONFIG_FILE_NAMES = /^typedaemon(_config)?\.(js|ts|json|ya?ml)$/;

export type HypervisorEvents = {
    app_lifecycle: (app: ApplicationInstance, event: AppLifecycle) => void;
}

export class Hypervisor extends TypedEmitter<HypervisorEvents> {
    constructor(private options: {
        working_directory: string,
        configFile?: string,
        no_watching?: boolean,
    }) {
        super();
    }

    private _state: "running" | "shutting_down" = "running";
    get state() { return this._state }

    get working_directory() { return this.options.working_directory }
    get operations_directory() { return path.resolve(this.working_directory, ".typedaemon") }

    protected cleanupTasks = new LifecycleHelper();

    private _currentConfig: Configuration;
    get currentConfig() {
        return this._currentConfig as DeepReadonly<typeof this._currentConfig>;
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
    });
    get logger() { return this._logger }

    logMessage(level: LogLevel, ...rest) {
        this.logger.logMessage(level, rest);
    }

    private updateLogConfiguration(cfg: Configuration['logging']) {
        let sys_file = cfg.system_file;
        sys_file ||= path.join(this.operations_directory, "logs", "%DATE%.log");

        this._logger?.close();

        this._logger = createDomainLogger({
            level: cfg.system,
            domain: chalk.cyan`Hypervisor`,
            file: path.resolve(this.working_directory, sys_file),
        });

        setFallbackLogger(
            createDomainLogger({
                domain: chalk.yellow("???"),
                file: path.resolve(this.working_directory, sys_file),
            })
        );
    }

    sharedStorages: SharedStorages;
    crossCallStore: CrossCallStore;

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
        })

        process.on("unhandledRejection", (err: any, origin) => {
            const app = current.application;
            if (app) {
                if (app.state == "dead" || app.state == "stopped") {
                    // Downgrade level if the error if it came in after death.
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
        })

        this.logMessage("info", "Starting Plugins");
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

        this.logMessage("info", "Starting Apps");
        this.appInstances.on("instance_lifecycle", (instance, levent) => {
            this.emit("app_lifecycle", instance, levent);
        });
        await this.appInstances.sync(this.currentConfig.apps || {});
        this.watchConfigEntry("apps", () => this.appInstances.sync(this.currentConfig.apps));
    }

    async shutdown() {
        this.logMessage("lifecycle", "Stopping");

        this._state = 'shutting_down';

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

    protected appInstances = new AppNamespace<AppConfiguration, Application, ApplicationInstance>(this, "Application", {
        Host: ApplicationInstance,
        getInstanceConfig: (id) => this.getConfigEntry(`apps.${id}`),
        summarizeInstance: (options) => chalk`{green ${options.export}} from {green ${options.source}}`,
    });
    getApplication(id: string) { return this.appInstances.getInstance(id); }

    private async readAndWatchConfig(file: string) {
        const no_watching = this.options.no_watching;

        const _loadConfig = async () => {
            let parsed = await readConfigFile(file);

            const cfg = ConfigMerger.mergeConfigs(defaultConfig, parsed);

            cfg.logging.plugins_file ||= cfg.logging.system_file;

            // cfg.logging.system_file = path.resolve(this.working_directory, cfg.logging.system_file);
            // cfg.logging.plugins_file = path.resolve(this.working_directory, cfg.logging.plugins_file);

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
