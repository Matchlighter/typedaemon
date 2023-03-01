
import fs = require("fs")
import path = require("path")
import deep_eql = require("deep-eql")
import chalk = require("chalk")
import moment = require("moment-timezone")

import { MultiMap } from "@matchlighter/common_library/cjs/data/multimap"
import { deep_get } from "@matchlighter/common_library/cjs/deep"

import { DeepReadonly, fileExists, resolveSourceFile, timeoutPromise, watchFile } from "../common/util";
import { LifecycleHelper } from "../common/lifecycle_helper";

import { Configuration, ConfigMerger, defaultConfig, readConfigFile } from "./config";
import { AppConfigMerger, AppConfiguration, defaultAppConfig } from "./config_app";
import { ApplicationInstance } from "./application_instance";
import { AppNamespace } from "./managed_apps";
import { PluginConfigMerger, PluginConfiguration, defaultPluginConfig } from "./config_plugin";
import { PluginInstance } from "./plugin_instance";
import { saveGeneratedTsconfig } from "../common/generate_tsconfig"
import { ConsoleMethod, ExtendedLoger, LogLevel, ORIGINAL_CONSOLE, createDomainLogger } from "./logging"
import { Plugin } from "../plugins/base"
import { Application } from "../runtime/application"

type ConfigWatchHandler<T> = (newConfig: T, oldConfig: T) => void;

const CONFIG_FILE_NAMES = /^typedaemon(_config)?\.(js|ts|json|ya?ml)$/;

export class Hypervisor {
    constructor(private options: {
        working_directory: string,
        configFile?: string,
        no_watching?: boolean,
    }) {

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
        this._logger = createDomainLogger({
            level: cfg.system,
            domain: chalk.cyan`Hypervisor`,
            file: path.resolve(this.working_directory, cfg.system_file),
        })
    }

    async start() {
        this.logMessage("lifecycle", "Starting");

        this.logMessage("info", "Loading Config");
        await this.findAndLoadConfig();

        this.getAndWatchConfigEntry("tsconfig", async (v) => {
            this.logMessage("debug", "Writing generated tsconfig.json");
            await saveGeneratedTsconfig(this)
        })

        this.getAndWatchConfigEntry("logging", (v) => this.updateLogConfiguration(v));
        this.getAndWatchConfigEntry("location.timezone", (tz: string) => moment.tz.setDefault(tz || undefined));

        process.on('SIGINT', async () => {
            console.log('');
            this.logMessage("info", "SIGINT received. Shutting down...");
            this._state = "shutting_down";
            await this.shutdown();
            process.exit(0);
        });

        this.logMessage("info", "Starting Plugins");
        const proms = this.pluginInstances.sync(this.currentConfig.plugins || {});
        await timeoutPromise(10000, Promise.allSettled(proms), () => {
            this.logMessage("warn", `Plugins failed to start within 10s`)
        });
        this.watchConfigEntry("plugins", () => this.pluginInstances.sync(this.currentConfig.plugins));

        this.logMessage("info", "Starting Apps");
        await this.appInstances.sync(this.currentConfig.apps || {});
        this.watchConfigEntry("apps", () => this.appInstances.sync(this.currentConfig.apps));
    }

    async shutdown() {
        this.logMessage("lifecycle", "Stopping");

        // Shutdown apps
        this.logMessage("info", "Stopping apps");
        await this.appInstances.shutdown();

        // Shutdown plugins
        this.logMessage("info", "Stopping plugins");
        await this.pluginInstances.shutdown();

        // Release file watchers and other cleanup
        this.logMessage("info", "Cleaning up");
        this.cleanupTasks.cleanup()
    }

    private async findAndLoadConfig() {
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
                        _thin_app_file: cfg.logging.system_file,
                        level: cfg.logging.application,
                        system_level: cfg.logging.system,
                    }
                }, raw_cfg);

                const sourcePath = path.resolve(this.working_directory, raw_cfg.source);
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

            // TODO In the apps case, current ordering is Shutdown removed, Create added, Update changed.
            //    Shutdown, Update, Create may be more semantic, but it probably doesn't really matter.
            //    Possible solution: Allow handlers to yield? - Basically allowing broader watchers to wrap narrower ones

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
