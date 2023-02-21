
import { AsyncLocalStorage } from 'async_hooks'
import { NodeVM, VM } from 'vm2';
import * as path from 'path';
import { TypedEmitter } from 'tiny-typed-emitter';
import * as chalk from 'chalk';

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

const CurrentAppStore = new AsyncLocalStorage<ApplicationInstance>()

export class RequireRestart extends Error { }
export class FallbackRequireRestart extends RequireRestart { }

export const current = {
    get application() { return CurrentAppStore.getStore() },
    get hypervisor() { return CurrentAppStore.getStore()?.hypervisor },
}

interface ApplicationInstanceEvents {
    started: () => void;
    stopping: () => void;
    stopped: () => void;
    lifecycle: (state: AppLifecycle) => void;
}

export type AppLifecycle = 'initializing' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead';

export class ApplicationInstance extends TypedEmitter<ApplicationInstanceEvents> {
    constructor(readonly hypervisor: Hypervisor, readonly id: string, options: AppConfiguration) {
        super()
        this.options = options;
    }

    readonly options: AppConfiguration;
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
        console.log(chalk`{greenBright [Application: ${this.id}]} - ${colorLogLevel(level)} -`, ...rest);
    }

    markFileDependency(file: string, quiet = false) {
        if (!this.options.watch.source) return;

        if (file == this.entrypoint) {
            this.logMessage("debug", `Watching entrypoint file (${chalk.green(file)}) for changes`);
        } else {
            this.logMessage("debug", `Noticed dependency on ${chalk.green(file)}, watching for changes`);
        }

        const watcher = watchFile(file, () => {
            this.restartAfterSourceChange();
        });
        this.cleanupTasks.mark(() => watcher.close());
    }

    @debounce({ timeToStability: 2000 })
    private restartAfterSourceChange() {
        this.logMessage("info", `Source dependency updated. Restarting`)
        this.hypervisor.reinitializeApplication(this);
    }

    async _start() {
        this.transitionState("starting")

        this.markFileDependency(this.entrypoint)

        const module = await this.compileModule();
        const AppClass = module[this.options.export || 'default'];
        this._instance = new AppClass(this);

        // Self-watch for config changes
        if (this.options.watch.config) {
            const disposer = this.hypervisor.watchConfigEntry<AppConfiguration>(`apps.${this.id}`, async (ncfg, ocfg) => {
                if (this.state != 'started') return;

                if (ncfg.source != ocfg.source || ncfg.export != ocfg.export) {
                    this.logMessage("debug", `Configuration changed significantly, restarting`);
                    this.hypervisor.reinitializeApplication(this);
                    return
                }

                this.logMessage("debug", `Configuration updated, processing changes`);

                try {
                    this.options.config = ncfg;
                    await this.invoke(() => this.instance.configuration_updated(ncfg, ocfg));
                } catch (ex) {
                    if (ex instanceof RequireRestart) {
                        this.logMessage("debug", `Determined that changes require an app restart, restarting`);
                        this.hypervisor.reinitializeApplication(this);
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

    private _state: AppLifecycle = "initializing";
    private transitionState(nstate: AppLifecycle) {
        this._state = nstate;
        this.logMessage("lifecycle", upcaseFirstChar(nstate))
        this.emit("lifecycle", nstate);
        this.emit(nstate as any);
    }
    get state() { return this._state }
}
