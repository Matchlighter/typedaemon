
import * as fs from "fs";
import * as md5 from "md5";
import * as path from "path";
import * as deep_eql from "deep-eql"
import * as chalk from "chalk";

import { MultiMap } from "@matchlighter/common_library/cjs/data/multimap"
import { deep_get } from "@matchlighter/common_library/cjs/deep"

import { DeepReadonly, colorLogLevel, fileExists, timeoutPromise, watchFile } from "../common/util";
import { debounce, throttle } from "../common/limit";
import { LifecycleHelper } from "../common/lifecycle_helper";

import { Configuration, ConfigMerger, defaultConfig, readConfigFile } from "./config";
import { AppConfigMerger, AppConfiguration, defaultAppConfig } from "./config_app";
import { ApplicationInstance } from "./application";
import { PluginInstance } from "../plugins/plugin";
import { ConsoleMethod } from "./vm";

type ConfigWatchHandler<T> = (newConfig: T, oldConfig: T) => void;

const CONFIG_FILE_NAMES = /^typedaemon(_config)?\.(js|ts|json|ya?ml)$/;

export class Hypervisor {
    constructor(private options: {
        working_directory: string,
        configFile?: string,
        no_watching?: boolean,
    }) {

    }

    private state: "running" | "shutting_down" = "running";

    get working_directory() { return this.options.working_directory }

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

    logMessage(level: ConsoleMethod | 'lifecycle', ...rest) {
        console.log(chalk`{blueBright [Hypervisor]} - ${colorLogLevel(level)} -`, ...rest);
    }

    async start() {
        this.logMessage("lifecycle", "Starting");

        this.logMessage("info", "Loading Config");
        await this.findAndLoadConfig();

        process.on('SIGINT', () => {
            this.logMessage("info", "SIGINT received. Shutting down...")
            this.state = "shutting_down";
            this.shutdown();
        });

        this.logMessage("info", "Starting Apps");
        await this.resyncApps();
        this.watchConfigEntry("apps", () => this.resyncApps());

        // TODO Start plugins, or make plugins lazy?
    }

    async shutdown() {
        this.logMessage("lifecycle", "Stopping");

        // Shutdown apps
        this.logMessage("info", "Stopping apps");
        for (let [id, app] of Object.entries(this.appInstances)) {
            this._shutdownApp(app);
        }
        await timeoutPromise(15000, Promise.all(this.appShutdownPromises), () => {
            this.logMessage("error", "At least one application has not shutdown after 15 seconds. Taking drastic action.");
            // TODO Drastic action
        });

        // Shutdown plugins
        this.logMessage("info", "Stopping plugins");
        // TODO Shutdown plugins
        await timeoutPromise(15000, Promise.all(this.appShutdownPromises), () => {
            this.logMessage("error", "At least one plugin has not shutdown after 15 seconds. Taking drastic action.");
            // TODO Drastic action
        });

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

    protected pluginInstances: Record<string, PluginInstance> = {};
    getPlugin(id: string) {
        return this.pluginInstances[id];
    }

    protected appInstances: Record<string, ApplicationInstance> = {};
    getApplication(id: string) {
        return this.appInstances[id];
    }

    @debounce({ timeToStability: 100, key_on: ([app]) => typeof app == 'string' ? app : app.id })
    async reinitializeApplication(app: string | ApplicationInstance) {
        if (typeof app == "string") {
            app = this.appInstances[app];
        }
        const id = app.id;
        await this._shutdownApp(app);
        this._startApp(id);
    }

    private _startApp(id: string, options?: AppConfiguration) {
        options ||= this.getConfigEntry(`apps.${id}`)

        this.logMessage("info", chalk`Starting App: '${id}' ({green ${options.export}} from {green ${options.source}})...`)

        const app = new ApplicationInstance(this, id, options);
        app._start().catch((ex) => {
            this.logMessage("error", `App '${id}' failed while starting up: `, ex)
            this._shutdownApp(app);
        });
        this.appInstances[id] = app;
        return app;
    }

    private appShutdownPromises = new Set<Promise<any>>();
    private _shutdownApp(app: string | ApplicationInstance) {
        if (typeof app == "string") {
            app = this.appInstances[app];
        }

        this.logMessage("info", `Stopping App: '${app.id}'...`)

        if (app != this.appInstances[app.id]) throw new Error("Attempt to reinitialize an inactive app");

        delete this.appInstances[app.id];

        const prom = app._shutdown();
        this.appShutdownPromises.add(prom);
        prom.then(() => this.appShutdownPromises.delete(prom));
        // TODO Set a timer to check that it actually stopped?
        return prom;
    }

    private async resyncApps() {
        if (this.state != "running") return;

        const currentInstances = { ...this.appInstances }
        const desiredApps = this.currentConfig.apps;

        // TODO Better support for dependencies.
        //   Each app to await other_app.state == 'started'.
        //   Restart apps here when one of it's deps change

        // Kill running apps that shouldn't be
        for (let [id, app] of Object.entries(currentInstances)) {
            if (!desiredApps[id]) {
                this._shutdownApp(app);
            }
        }

        // Notify apps of config changes. Allow app to decide if it can handle it, or if it needs a reboot.
        // (Each application manages this for itself)

        // Startup apps that should be running, but aren't
        for (let [id, options] of Object.entries(desiredApps)) {
            if (!this.appInstances[id]) {
                this._startApp(id, options);
            }
        }
    }

    private async readAndWatchConfig(file: string) {
        const no_watching = this.options.no_watching;

        const _loadConfig = async () => {
            let parsed = await readConfigFile(file);

            const cfg = ConfigMerger.mergeConfigs(defaultConfig, parsed);

            if (no_watching) {
                cfg.daemon.watch = { app_configs: false, app_source: false, config: false }
            }

            for (let [ak, acfg] of Object.entries(cfg.apps)) {
                const appcfg = AppConfigMerger.mergeConfigs(defaultAppConfig, {
                    watch: {
                        config: cfg.daemon.watch?.app_configs,
                        source: cfg.daemon.watch?.app_source,
                    }
                }, acfg);
                
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
            this.logMessage("info", `Watching config file ${chalk.green(file)}`)
            const watcher = watchFile(file, () => {
                this.logMessage("info", `Reloading Typedaemon Config`)
                _loadConfig()
            });
            this.cleanupTasks.mark(() => watcher.close());
        }
    }
}
