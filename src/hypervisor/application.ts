
import { AsyncLocalStorage } from 'async_hooks'

import { AppConfiguration } from "./config_app";
import { LifecycleHelper } from '../common/lifecycle_helper';
import { Hypervisor } from './hypervisor';
import { ResumableStore } from '../runtime/resumable_store';

const CurrentAppStore = new AsyncLocalStorage<ApplicationInstance>()

class RequireRestart extends Error {}

export const current = {
    get application() { return CurrentAppStore.getStore() },
}

export class ApplicationInstance {
    constructor(readonly hypervisor: Hypervisor, readonly id: string, options: AppConfiguration) {
        
    }

    readonly options: AppConfiguration;

    private _state: 'starting' | 'started' | 'stopping' | 'stopped' | 'dead' = "starting";
    get state() { return this._state }

    readonly cleanupTasks = new LifecycleHelper();
    readonly resumableStore = new ResumableStore();

    private _instance;
    get instance() { return this._instance }

    async invoke(what: string | symbol, parameters?: any[])
    async invoke<T>(func: () => T)
    async invoke(what, params?) {
        if (typeof what == 'function') {
            return CurrentAppStore.run(this, () => {
                return what();
            })
        } else {
            return this.invoke(() => this.instance[what](...params))
        }
    }

    async _start() {
        const module = await import(this.options.source);
        const AppClass = module[this.options.export || 'default'];
        this._instance = new AppClass();

        // Self-watch for config changes
        if (this.options.watch?.config) {
            const disposer = this.hypervisor.watchConfigEntry(`apps.${this.id}`, async (ncfg, ocfg) => {
                if (this.instance.configuration_updated) {
                    try {
                        await this.invoke(() => this.instance.configuration_updated(ncfg, ocfg));
                    } catch (ex) {
                        if (ex instanceof RequireRestart) {
                            this.hypervisor.reinitializeApplication(this);
                        } else {
                            throw ex;
                        }
                    }
                }
            });
            this.cleanupTasks.mark(disposer);
        }

        await this.invoke(() => this.instance.initialize?.());
        await this.resumableStore.resume([], {
            app: this._instance,
        })

        this._state = 'started';
    }

    async _shutdown() {
        this._state = 'stopping';
        this.cleanupTasks.cleanup();
        const resumables = await this.resumableStore.suspendAndStore();
        // TODO Write to file
        this._state = 'stopped';
    }
}
