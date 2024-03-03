
import { exists } from 'fs-extra';
import { AsyncReturnType } from 'type-fest';
import path = require('path');
import chalk = require('chalk');
import deepEqual = require('deep-eql');
import fs = require('fs');
import md5 = require('md5');
import extract_comments = require('extract-comments');

import { debounce } from "@matchlighter/common_library/limit";

import { TYPEDAEMON_PATH, fileExists, trim, watchFile } from '../common/util';
import { PluginNotStartedError, flushPluginAnnotations } from '../plugins/base';
import { Application } from '../runtime/application';
import { ResumableStore, resumable } from '../runtime/resumable';
import { AppConfiguration } from "./config_app";
import { DestroyerStore } from './destroyer';
import { BaseInstance, InstanceLogConfig } from './managed_apps';
import { RequireRestart, configChangeHandler } from './managed_config_events';
import { installDependencies } from './packages';
import { PersistentStorage } from './persistent_storage';
import { createApplicationVM, determineModuleContext } from './vm';

export interface ApplicationMetadata {
    applicationClass?: typeof Application;
    dependencies?: any;
}

export type AppLifecycle = 'initializing' | 'compiling' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead';

export type MyConditionalKeys<Base, Condition> = {
    [Key in keyof Base]: Base[Key] extends Condition ? Base[Key] : never;
};

type LifecycleHookType = "started";

class ShuttingDown extends Error { };

const MessagingHandled = Symbol("MessagingHandled");

export class ApplicationInstance extends BaseInstance<AppConfiguration, Application, {}> {
    get uuid() {
        return this.options.uuid || this.id;
    }

    get app_config() {
        return this.options.config;
    }

    get entrypoint() {
        return path.resolve(this.hypervisor.working_directory, this.options.source)
    }

    resumableStore: ResumableStore;
    persistedStorage: PersistentStorage;
    destroyerStore: DestroyerStore;

    protected loggerFile() {
        const lopts = this.options.logging;
        let file = lopts?.file;
        file ||= path.join(this.operating_directory, "logs/", "%DATE%.log");
        file = path.resolve(this.hypervisor.working_directory, file);
        return file;
    }

    protected loggerOptions(): InstanceLogConfig {
        const lopts = this.options.logging;
        const file = this.loggerFile();
        return {
            tag: chalk.blue`App: ${this.id}`,
            manager: {
                file: file,
                level: lopts?.system_level,
            },
            user: {
                file: file,
                level: lopts?.level,
                // domain: chalk.blue.italic`App: ${this.id}`,
                label_format: "[[%MSG%]]"
            },
        }
    }

    private watchedDependencies = new Set<string>();
    markFileDependency(file: string, calling_module?: string) {
        if (!this.options.watch?.source) return;
        if (determineModuleContext(file) != "sandbox") return;
        if (file.includes("/node_modules/")) return;
        if (file.includes(TYPEDAEMON_PATH) && !file.includes(this.hypervisor.working_directory)) return;

        // Don't watch the new file if it was somehow hopped to
        // if (calling_module && !this.watchedDependencies.has(calling_module)) return;

        if (file == this.entrypoint) {
            this.logMessage("debug", `Watching entrypoint file (${chalk.green(file)}) for changes`);
        } else {
            this.logMessage("debug", `Noticed dependency on ${chalk.green(file)}, watching for changes`);
        }

        const watcher = watchFile(file, () => {
            this.restartAfterSourceChange();
        });
        this.watchedDependencies.add(file);

        this.cleanups.append(() => {
            watcher.close()
            this.watchedDependencies.delete(file);
        }, { tags: ["watcher"] });
    }

    @debounce({ timeToStability: 2000, unref: true })
    private restartAfterSourceChange() {
        this.logMessage("info", `Source dependency updated. Restarting`)
        this.namespace.reinitializeInstance(this);
    }

    lifecycle_hooks: Partial<Record<LifecycleHookType, (() => void)[]>> = {};

    private async fireLifecycleHooks(type: LifecycleHookType) {
        const hooks = this.lifecycle_hooks[type] || []

        await this.invoke(async () => {
            for (let hook of hooks) {
                await hook();
            }
        })
    }

    addLifeCycleHook(event: LifecycleHookType, hook: () => void) {
        const hooks = this.lifecycle_hooks[event] ||= [];
        hooks.push(hook);
    }

    async _start() {
        try {
            if (!await fileExists(this.entrypoint)) {
                throw new Error(`Application entrypoint '${this.entrypoint}' not found`)
            }

            await fs.promises.mkdir(this.operating_directory, { recursive: true });
            await fs.promises.mkdir(this.shared_operating_directory, { recursive: true });
            await fs.promises.mkdir(path.dirname(this.loggerFile()), { recursive: true });

            // Self-watch for config changes
            if (this.options.watch?.config) {
                const handler = configChangeHandler(this, async ({ handle, invoke_client_handler, ncfg, ocfg }) => {
                    if (!deepEqual(immutableConfigBits(ocfg), immutableConfigBits(ncfg))) {
                        this.logMessage("debug", `Configuration changed significantly, restarting`);
                        throw new RequireRestart()
                    }

                    await handle("logging", async () => {
                        this.options.logging = ncfg.logging;
                        this._updateLogConfig();
                    })

                    await handle("config", async (nappcfg, oappcfg) => {
                        if (this.state != 'started') throw new RequireRestart();
                        await invoke_client_handler(nappcfg, oappcfg);
                        this.options["config"] = nappcfg;
                    })
                });
                const disposer = this.hypervisor.watchConfigEntry<AppConfiguration>(`apps.${this.id}`, handler);
                this.cleanups.append(disposer, { tags: ["watcher"] });
            }

            // Watch the main entrypoint
            this.markFileDependency(this.entrypoint);

            // Load PersistentStorage
            this.logMessage("debug", `Loading PersitentStorage`);
            this.persistedStorage = new PersistentStorage(path.join(this.operating_directory, ".persistence.jkv"));
            await this.persistedStorage.load();
            this.cleanups.append(() => this.persistedStorage.dispose());

            //#region Package Installation
            const moduleSource = (await fs.promises.readFile(this.entrypoint)).toString();

            this.logMessage("debug", `Parsing package dependencies`);
            const { dependencies } = parseAnnotations(moduleSource);

            // Items in the config override any that are in the source
            Object.assign(dependencies, this.options.dependencies || {});

            const packageFilePath = path.join(this.shared_operating_directory, "package.json");
            let packageJson: any = {};
            let shouldManagePackage = !await fileExists(packageFilePath);
            if (!shouldManagePackage) {
                packageJson = JSON.parse((await fs.promises.readFile(packageFilePath)).toString());
                if (packageJson['typedaemon_managed']) {
                    shouldManagePackage = true;
                } else if (Object.keys(dependencies).length > 0) {
                    this.logMessage("warn", `Source file includes dependency annotations, but a non-managed package.json file was found. In-file dependency annoations will be ignored.`)
                }
            }

            if (shouldManagePackage) {
                this.logMessage("debug", `Generating managed package.json`);
                // TODO Do not install items that are available in the Host
                packageJson = this.generateOpPackageJson({ dependencies });
                await fs.promises.writeFile(packageFilePath, JSON.stringify(packageJson));
            }

            // if (Object.keys(packageJson?.dependencies || {}).length > 0) {
            this.logMessage("info", `Installing packages`);
            // TODO Skip if unchanged
            //   - Add a file (eg .tdmeta) to the shared_operating_directory?
            await this.invoke(() => installDependencies({
                dir: this.shared_operating_directory,
                lockfile: this.isThickApp,
                devPackages: true,
            }));
            //#endregion

            // Abort if the app started shutting down
            this.assert_not_shutdown();

            // Setup Destroyer Store
            this.destroyerStore = new DestroyerStore(this);
            this.cleanups.append(() => this.destroyerStore.dispose());

            this.transitionState("compiling");

            // Initialize VM and execute entry module
            let module;
            try {
                module = await this.compileModule();
            } catch (ex) {
                this.handle_client_startup_error(ex);
                return;
            }

            this.cleanups.append(() => this._vm.removeAllListeners?.());
            const mainExport = module[this.options.export || 'default'];
            const metadata: ApplicationMetadata = (typeof mainExport == 'object' && mainExport) || mainExport.metadata || module.metadata || { applicationClass: mainExport, ...module, ...mainExport };

            // Abort if the app started shutting down
            this.assert_not_shutdown();

            this.transitionState("starting")

            // Instanciate App instance
            const AppClass = metadata.applicationClass;
            try {
                this._instance = new AppClass(this);
            } catch (ex) {
                this.handle_client_startup_error(ex);
            }

            resumable.register_context("APPLICATION", this._instance, true);

            this.resumableStore = new ResumableStore({
                file: path.join(this.operating_directory, ".resumable_state.json"),
            }, {
                "APPLICATION": this._instance,
            })

            this.cleanups.append(() => this.invoke(() => this.instance.shutdown?.()));

            // Invoke App initialize method
            try {
                // TODO Timeout or cancel during restart
                await this.invoke(() => this.instance.initialize?.());
            } catch (ex) {
                this.handle_client_startup_error(ex);
            }

            // Abort if the app started shutting down
            this.assert_not_shutdown();

            // Apply Plugin Annotations and load Resumables
            await this.invoke(async () => {
                // TODO Skip if initialize already did this
                await flushPluginAnnotations(this.instance);
                await this.resumableStore.load();
            })

            // We want this to run before the userspace app has completely shutdown
            this.cleanups.append(async () => {
                this.logMessage("info", "Suspending Resumables")
                await this.invoke(() => this.resumableStore.save());
            });

            // Abort if the app started shutting down
            this.assert_not_shutdown();

            this.transitionState('started');

            await this.hypervisor.crossCallStore.handleAppStart(this);

            // Abort if the app started shutting down
            this.assert_not_shutdown();

            await this.fireLifecycleHooks("started");
        } catch (ex) {
            if (ex instanceof ShuttingDown) return;

            if (!ex[MessagingHandled]) {
                this.logClientMessage("error", `Failed while starting up: `, ex, ex?.stack);
            }

            // There's "dead" and "mostly dead" - we go for "mostly dead" so that watchers are kept live and can trigger a restart
            this.transitionState("dead");
            await this.cleanups.cleanup({ except_tags: ["watcher"] });

            throw ex;
        }
    }

    /** Cleanup all traces of the application */
    async destroy_all() {
        // TODO We may want to redirect all logs from this method to the Hypervisor so that the deletion logs don't immediately get deleted
        if (!this.destroyerStore) {
            if (!await exists(this.operating_directory)) return;
            this.destroyerStore = new DestroyerStore(this);
            await this.destroyerStore.load();
        }
        await this.invoke(async () => {
            await this.destroyerStore.destroyApplication();
        })
    }

    private generateOpPackageJson({ dependencies }) {
        return {
            "name": this.id,
            "version": "0.0.1",
            "license": "UNLICENSED",
            "typedaemon_managed": true,
            "dependencies": dependencies,
        }
    }

    get isLiteApp() {
        return !this.isThickApp;
    }

    private _isThickApp;
    get isThickApp() {
        if (this._isThickApp == null) {
            this._isThickApp = fs.existsSync(path.join(this.source_directory, 'package.json'));
        }
        return this._isThickApp;
    }

    get shared_operating_directory() {
        if (this.isThickApp) return this.source_directory;

        // TODO Cleanup this directory automatically when no apps are using it?
        let entrypoint = path.relative(this.hypervisor.working_directory, this.entrypoint);
        let uname = entrypoint.replace(/\.\.\\/g, "").replace(/\.[tj]s$/, "").replace(/\//g, "_") + "-" + md5(entrypoint).slice(0, 6);
        return path.resolve(this.hypervisor.operations_directory, "source_environments", uname)
    }

    get operating_directory() {
        const wd = this.hypervisor.working_directory;

        if (this.options.operating_directory) {
            return path.resolve(wd, this.options.operating_directory);
        }

        // Nice but conflicting if there are multiple app instances
        // if (this.isThickApp) {
        //     return path.dirname(this.entrypoint);
        // }

        return path.resolve(this.hypervisor.operations_directory, "app_environments", this.id);
    }

    get source_directory() {
        return path.dirname(this.entrypoint);
    }

    private async compileModule() {
        return await this.invoke(async () => {
            const vm = await this.vm();
            return vm.runFile(this.entrypoint);
        })
    }

    private _vm: AsyncReturnType<typeof createApplicationVM>;
    private async vm() {
        if (this._vm) return this._vm;
        const vm = await createApplicationVM(this);
        return this._vm = vm;
    }

    get unsafe_vm() {
        return this._vm;
    }

    private handle_client_startup_error(err: Error) {
        if (err instanceof PluginNotStartedError) {
            this.logClientMessage("warn", `Tried to use a plugin (${err.plugin_id}) that hasn't started yet. Will retry app startup later`)

            const plh = this.hypervisor.getPlugin(err.plugin_id);
            const handler = (state: AppLifecycle) => {
                if (state == "started") {
                    plh.off("lifecycle", handler);
                    this.namespace.reinitializeInstance(this);
                }
            }

            plh.on("lifecycle", handler);

            this.cleanups.append(() => {
                plh.off("lifecycle", handler);
            }, { tags: ["watcher"] })

            err[MessagingHandled] = true;

            throw err;
        } else {
            // this.invoke(() => {
            //     this.logClientMessage("error", `Failed while starting up: `, err);
            // })
            throw err;
        }
    }

    private assert_not_shutdown() {
        if (this.state == "stopping" || this.state == "stopped" || this.state == "dead") {
            throw new ShuttingDown();
        }
    }
}

function immutableConfigBits(cfg: AppConfiguration): Partial<AppConfiguration> {
    const immutable = { ...cfg };
    delete immutable.config;
    delete immutable.logging;
    delete immutable.watch;
    return immutable
}

function parseAnnotations(code: string) {
    const dependencies = {}

    const noteDependency = (pkg: string, version: string) => {
        pkg = trim(pkg, /[\s'"]/);
        version = trim(version || '*', /[\s'"]/);
        if (dependencies[pkg] && dependencies[pkg] != version) {
            throw new Error(`A different version of '${pkg}' is already required!`)
        }
        dependencies[pkg] = version;
    }

    for (let comment of extract_comments(code) as { type: string, value: string }[]) {
        if (comment.type != "BlockComment") continue;

        const { value } = comment;

        // @dependencies { package: 0.1.2, package2: 3.4.5 }
        for (let m of value.matchAll(/@dependencies\s*\{(.*)\}/sg)) {
            const items = m[1].trim().split(/[,\n]+/).map(l => l.trim())
            for (let d of items) {
                if (!d) continue;
                const [pkg, version] = d.split(/[ :]+/);
                noteDependency(pkg, version);
            }
        }

        // @dependency package 0.1.2
        for (let m of value.matchAll(/@dependency\s+([\w-_]+)(:|\s+)(.+)\s*$/mg)) {
            noteDependency(m[1], m[3]);
        }
    }

    return { dependencies }
}
