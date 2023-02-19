
import * as fs from "fs";
import * as md5 from "md5";
import * as path from "path";
import * as deep_eql from "deep-eql"

import { DeepReadonly } from "common/util";
import { Configuration, ConfigMerger, defaultConfig, readConfigFile } from "./config";

import { MultiMap } from "@matchlighter/common_library/cjs/data/multimap"
import { deep_get } from "@matchlighter/common_library/cjs/deep"

import { AppConfigMerger, AppConfiguration, defaultAppConfig } from "./config_app";
import { ApplicationInstance } from "./application";
import { LifecycleHelper } from "../common/lifecycle_helper";

const async_throttle = <T extends (...params: any[]) => void>(time: number, func: T): T => {
    let working = false;
    let lastCallTime: number;
    let nextCallParams: Parameters<T>;

    let nextCallTimer;

    const workItOff = async () => {
        working = true;
        while (nextCallParams) {
            const p = nextCallParams;
            nextCallParams = null;
            try {
                await func(...p);
            } catch {
            }
        }
        working = false;
    }

    return ((...args: Parameters<T>) => {
        if (working) {
            nextCallParams = args;
        } else if (lastCallTime && Date.now() < lastCallTime + time) {
            const nextCallIn = lastCallTime + time - Date.now();
            if (!nextCallTimer) {
                nextCallTimer = setTimeout(() => {
                    nextCallTimer = null;
                }, nextCallIn)
            }
        } else {
            lastCallTime = Date.now();
            nextCallParams = args;
            workItOff()
        }
    }) as any;
}

const watchFile = (file: string, callback: (file: string) => void, config: { debounce: number } = { debounce: 250 }) => {
    let md5Previous = null;

    const throttled_callback = async_throttle(config.debounce, async (_file: string) => {
        const md5Current = md5(await fs.promises.readFile(file));
        if (md5Current === md5Previous) return;
        md5Previous = md5Current;

        await callback(file);
    })

    return fs.watch(file, throttled_callback);
}

const fileExists = async (file: string) => {
    try {
        const stat = await fs.promises.stat(file);
        return !!stat;
    } catch {
        return false;
    }
}

type ConfigWatchHandler<T> = (newConfig: T, oldConfig: T) => void;

const CONFIG_FILE_NAMES = /^typedaemon(_config)?\.(js|ts|json|ya?ml)$/;

export class Hypervisor {
    constructor(private options: {
        working_directory: string,
        configFile?: string,
        no_watching?: boolean,
    }) {

    }

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

    async start() {
        await this.findAndLoadConfig();

        await this.resyncApps();
        this.watchConfigEntry("apps", () => this.resyncApps());

        // TODO Start plugins, or make plugins lazy?
    }

    async shutdown() {
        // Release file watchers
        this.cleanupTasks.cleanup()
        // TODO Shutdown apps
        // TODO Shutdown plugins
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

    protected appInstances: Record<string, ApplicationInstance> = {};

    getApplication(id: string) {
        return this.appInstances[id];
    }

    reinitializeApplication(app: string | ApplicationInstance) {
        if (typeof app == "string") {
            app = this.appInstances[app];
        }
        const id = app.id;
        this._shutdownApp(app);
        this._startApp(id);
    }

    private _startApp(id: string, options?: AppConfiguration) {
        options ||= this.getConfigEntry(`apps.${id}`)
        const app = new ApplicationInstance(this, id, options);
        app._start();
        this.appInstances[id] = app;
        return app;
    }

    private _shutdownApp(app: string | ApplicationInstance) {
        if (typeof app == "string") {
            app = this.appInstances[app];
        }
        if (app != this.appInstances[app.id]) throw new Error("Attempt to reinitialize an inactive app");
        app._shutdown();
    }

    private async resyncApps() {
        const currentInstances = { ...this.appInstances }
        const desiredApps = this.currentConfig.apps;

        // Kill running apps that shouldn't be
        for (let [id, app] of Object.entries(currentInstances)) {
            if (!desiredApps[id]) this._shutdownApp(app);
        }

        // TODO Notify apps of config changes. Allow app to decide if it can handle it, or if it needs a reboot. (Do not do if apps utilize their own watchers)

        // Startup apps that should be running, but aren't
        for (let [id, options] of Object.entries(desiredApps)) {
            if (!this.appInstances[id]) this._startApp(id, options);
        }
    }

    private async readAndWatchConfig(file: string) {
        const _loadConfig = async () => {
            let parsed = await readConfigFile(file);
            const cfg = ConfigMerger.mergeConfigs(defaultConfig, parsed);
            for (let [ak, acfg] of Object.entries(cfg.apps)) {
                cfg.apps[ak] = AppConfigMerger.mergeConfigs(defaultAppConfig, {
                    watch: {
                        config: cfg.daemon.watch?.app_configs,
                        source: cfg.daemon.watch?.app_source,
                    }
                }, acfg);
            }

            // console.debug("Loaded Config", cfg)

            const prevConfig = this.currentConfig;
            this._currentConfig = cfg;

            // TODO In the apps case (and if using per-app watchers), current ordering is Shutdown removed, Create added, Update changed.
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

        if (!this.options.no_watching) {
            const watcher = watchFile(file, () => {
                console.info("Reloading Typedaemon Config")
                _loadConfig()
            });
            this.cleanupTasks.mark(() => watcher.close());
        }
    }
}
