
import { AsyncLocalStorage } from 'async_hooks'
import { NodeVM, VM } from 'vm2';
import * as path from 'path';
import { TypedEmitter } from 'tiny-typed-emitter';
import * as chalk from 'chalk';
import deepEqual = require('deep-eql');

import { upcaseFirstChar } from "@matchlighter/common_library/cjs/strings"

import { AppConfiguration } from "./config_app";
import { LifecycleHelper } from '../common/lifecycle_helper';
import { Hypervisor } from './hypervisor';
import { ResumableStore } from '../runtime/resumable_store';
import { Application } from '../runtime/application';
import { PersistentStorage } from './persistent_storage';
import { ConsoleMethod, createApplicationVM } from './vm';
import { colorLogLevel, watchFile } from '../common/util';
import { debounce } from '../common/limit';
import { BaseInstance } from './managed_apps';

const CurrentAppStore = new AsyncLocalStorage<ApplicationInstance>()

export class RequireRestart extends Error { }
export class FallbackRequireRestart extends RequireRestart { }

export const current = {
    get application() { return CurrentAppStore.getStore() },
    get hypervisor() { return CurrentAppStore.getStore()?.hypervisor },
}

export interface ApplicationMetadata {
    applicationClass?: typeof Application;
    dependencies?: any;
}

export type AppLifecycle = 'initializing' | 'compiling' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead';

export class ApplicationInstance extends BaseInstance<AppConfiguration, {}> {
    get app_config() {
        return this.options.config;
    }

    get entrypoint() {
        return path.resolve(this.hypervisor.working_directory, this.options.source)
    }

    readonly cleanupTasks = new LifecycleHelper();
    readonly resumableStore = new ResumableStore();
    readonly persistedStorage: PersistentStorage = new PersistentStorage();

    private _instance: Application;
    get instance() { return this._instance }

    invoke<F extends (...params: any[]) => any>(func: F, ...params: Parameters<F>): ReturnType<F>
    invoke(what: string | symbol, parameters?: any[])
    invoke(what, ...params) {
        if (!what) throw new Error("Must pass a method to invoke");

        if (typeof what == 'function') {
            return CurrentAppStore.run(this, () => {
                return what.call(this.instance, ...params);
            })
        } else {
            return this.invoke(this.instance[what], ...params);
        }
    }

    logMessage(level: ConsoleMethod | 'system' | 'lifecycle', ...rest) {
        console.log(chalk`{blue [Application: ${this.id}]} - ${colorLogLevel(level)} -`, ...rest);
    }

    includedFileScope(file: string) {
        if (!file) return "sandbox";
        // TODO If hosted_module, "host"
        // TODO If global dependency, "host"
        // TODO If app dependency, "sandbox"
        if (file.match(/node_modules/)) {
            return "host"
        };
        return "sandbox";
    }

    private watchedDependencies = new Set<string>();
    markFileDependency(file: string, calling_module?: string) {
        if (!this.options.watch?.source) return;
        if (this.includedFileScope(file) != "sandbox") return;

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

        this.cleanupTasks.mark(() => {
            watcher.close()
            this.watchedDependencies.delete(file);
        });
    }

    @debounce({ timeToStability: 2000 })
    private restartAfterSourceChange() {
        this.logMessage("info", `Source dependency updated. Restarting`)
        this.namespace.reinitializeInstance(this);
    }

    async _start() {
        this.transitionState("compiling");

        this.markFileDependency(this.entrypoint)

        const module = await this.compileModule();
        // TODO Ordering is bad here = module needs deps, but deps are stored on module.
        //   We're going to need to so some static analysis.
        //   Or have require return proxies.
        //   Or compile the module twice - host modules are linked as expected, missing modules are set as undefined.
        //     We can skip the second iteration if all modules are already installed
        const mainExport = module[this.options.export || 'default'];
        const metadata: ApplicationMetadata = (typeof mainExport == 'object' && mainExport) || mainExport.metadata || module.metadata || { applicationClass: mainExport, ...module, ...mainExport };

        const dependencies = {
            ...metadata.dependencies,
            ...this.options.dependencies || {},
        }
        if (Object.keys(dependencies).length > 0) {
            this.logMessage("info", `Installing Dependencies`);
            // TODO
        }

        this.transitionState("starting")

        const AppClass = metadata.applicationClass;
        this._instance = new AppClass(this);

        // Self-watch for config changes
        if (this.options.watch?.config) {
            const disposer = this.hypervisor.watchConfigEntry<AppConfiguration>(`apps.${this.id}`, async (ncfg, ocfg) => {
                if (this.state != 'started') return;

                if (!deepEqual(immutableConfigBits(ocfg), immutableConfigBits(ncfg))) {
                    this.logMessage("debug", `Configuration changed significantly, restarting`);
                    this.namespace.reinitializeInstance(this);
                    return
                }

                this.logMessage("debug", `Configuration updated, processing changes`);

                try {
                    this.options.config = ncfg;
                    await this.invoke(() => this.instance.configuration_updated(ncfg, ocfg));
                } catch (ex) {
                    if (ex instanceof RequireRestart) {
                        this.logMessage("debug", `Determined that changes require an app restart, restarting`);
                        this.namespace.reinitializeInstance(this);
                    } else {
                        this.logMessage("error", `Error occurred while updating configuration:`, ex);
                        throw ex;
                    }
                }
            });
            this.cleanupTasks.mark(disposer);
        }

        // TODO Load and await required plugins (determine by whether the app `require("ha")`?)
        //    Or are plugins just assumed to be loaded?

        await this.invoke(() => this.instance.initialize?.());
        await this.resumableStore.resume([], {
            app: this._instance,
        })

        this.transitionState('started');
    }

    async _shutdown() {
        this.transitionState('stopping')

        if (this.instance) {
            await this.invoke(() => this.instance.shutdown?.());
        }

        this.cleanupTasks.cleanup();

        const resumables = await this.resumableStore.suspendAndStore();
        // TODO Write to file

        if (this._vm) this._vm.removeAllListeners();

        this.transitionState('stopped')
    }

    private async compileModule() {
        const vm = this.vm();
        return vm.runFile(this.entrypoint);
    }

    private _vm: NodeVM;
    private vm() {
        if (this._vm) return this._vm;
        const vm = createApplicationVM(this);
        return this._vm = vm;
    }
}

function immutableConfigBits(cfg: AppConfiguration): Partial<AppConfiguration> {
    const immutable = { ...cfg };
    delete immutable.config;
    delete immutable.logs;
    delete immutable.watch;
    return immutable
}
