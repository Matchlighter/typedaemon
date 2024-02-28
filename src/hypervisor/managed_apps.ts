import chalk = require("chalk");
import { AsyncLocalStorage } from "async_hooks";
import { ListenerSignature, TypedEmitter } from "tiny-typed-emitter";
import { ConditionalKeys, Merge } from "type-fest";

import { debounce } from "@matchlighter/common_library/limit";
import { upcaseFirstChar } from "@matchlighter/common_library/strings";

import { LifecycleHelper } from "../common/lifecycle_helper";
import { timeoutPromise } from "../common/util";
import { AppLifecycle } from "./application_instance";
import { Hypervisor } from "./hypervisor";
import { ExtendedLoger, LogLevel, LoggerOptions, createDomainLogger } from "./logging";

interface LifecycleEvents {
    // started: () => void;
    // stopping: () => void;
    // stopped: () => void;
    lifecycle: (state: AppLifecycle) => void;
}

export const HyperWrapper = Symbol("Hypervisor Application");
export const CurrentInstanceStack = new AsyncLocalStorage<BaseInstance<any, any, any>[]>()

export class BaseInstanceClient<I extends BaseInstance<C>, C = any> {
    constructor(hyper_wrapper: I) {
        this[HyperWrapper] = hyper_wrapper;
    }

    initialize() { }

    /**
     * Add logic for destructing this application.
     * 
     * Called _after_ any cleanups that were registered by initialize, but _before_ any system cleanups
     * 
     * It is recommended to use `on_shutdown` instead when possible.
     */
    shutdown() { }

    /**
     * Access the underlying Instance object in the Hypervisor.
     * 
     * IF YOU ARE DEVELOPING AN APPLICATION, YOU SHOULD PROBABLY AVOID THIS
     */
    [HyperWrapper]: I;
}

interface InstanceContext {
    hypervisor: Hypervisor;
    id: string;
    namespace: AppNamespace;
}

interface LoggerTypeOptions extends LoggerOptions {
    level: LogLevel;
    file: string;
}

export interface InstanceLogConfig {
    tag: string;
    user?: LoggerTypeOptions;
    manager?: LoggerTypeOptions;
}

export abstract class BaseInstance<C, A extends BaseInstanceClient<any> = BaseInstanceClient<any>, const L extends ListenerSignature<L> = any> extends TypedEmitter<Merge<L, LifecycleEvents>> {
    constructor(readonly context: InstanceContext, readonly options: C) {
        super()

        this._updateLogConfig();
    }

    protected _instance: A;
    get instance() { return this._instance }

    readonly cleanups = new LifecycleHelper();

    get id() { return this.context.id }
    get hypervisor() { return this.context.hypervisor }
    get namespace() { return this.context.namespace }

    protected logPrefix: string;

    private _logger: ExtendedLoger;
    get logger() { return this._logger }

    private _userSpaceLogger: ExtendedLoger;
    get userSpaceLogger() { return this._userSpaceLogger }

    abstract _start(): Promise<any>

    async _shutdown() {
        this.transitionState('stopping')
        await this.invoke(() => this.cleanups.cleanup())
        this.transitionState('stopped')
    }

    logMessage(level: LogLevel, ...rest) {
        this.logger.logMessage(level, rest);
    }

    logClientMessage(level: LogLevel, ...rest) {
        this.userSpaceLogger.logMessage(level, rest);
    }

    protected _updateLogConfig() {
        const { tag: domain, manager, user, ...rest } = this.loggerOptions();
        const transport_cache = {};

        this._logger = createDomainLogger({
            level: "warn",
            domain,
            ...rest,
            ...manager,
            transport_cache,
        })

        this._userSpaceLogger = createDomainLogger({
            level: "debug",
            domain,
            ...rest,
            ...user,
            transport_cache,
        })
    }

    /**
     * Prepare for calling client-side methods.
     * This sets up contexts/globals so that the global APIs can implicitly reference the calling application
     */
    // @ts-ignore
    invoke<K extends ConditionalKeys<this, ((...params: any[]) => any)>>(what: K, ...parameters: Parameters<this[K]>): ReturnType<this[K]>
    invoke<F extends (...params: any[]) => any>(func: F, ...params: Parameters<F>): ReturnType<F>
    invoke(what, ...params) {
        if (!what) throw new Error("Must pass a method to invoke");

        if (typeof what == 'function') {
            const curStack = CurrentInstanceStack.getStore() || [];

            if (curStack[curStack.length - 1] == this) return what.call(this.instance, ...params);

            return CurrentInstanceStack.run([...curStack, this], () => {
                return what.call(this.instance, ...params);
            })
        } else {
            return this.invoke(this.instance[what], ...params);
        }
    }

    private _state: AppLifecycle = "initializing";
    protected transitionState(nstate: AppLifecycle) {
        this._state = nstate;
        this.logClientMessage("lifecycle", upcaseFirstChar(nstate))
        // @ts-ignore
        this.emit("lifecycle", nstate);
        // @ts-ignore
        // this.emit(nstate as any);
    }
    get state() { return this._state }

    protected loggerOptions(): InstanceLogConfig {
        return { tag: '???' }
    }
}

export interface BaseInstanceConfig {

}

export interface InstanceConstructor<T extends BaseInstance<C, any>, C extends BaseInstanceConfig> {
    new(context: InstanceContext, options: C): T;
}

export type AppNamespaceEvents<T extends BaseInstance<any, any, any>> = {
    instance_lifecycle: (instance: T, event: AppLifecycle) => void;
}

export class AppNamespace<C extends BaseInstanceConfig = BaseInstanceConfig, A extends BaseInstanceClient<any> = BaseInstanceClient<any>, T extends BaseInstance<C> = BaseInstance<C>>
    extends TypedEmitter<AppNamespaceEvents<T>>
{
    constructor(
        readonly hypervisor: Hypervisor,
        readonly name: string,
        readonly options: {
            Host: InstanceConstructor<T, C>,
            getInstanceConfig: (id: string) => C,
            summarizeInstance?: (config: C) => string,
        },
    ) {
        super();
        this.logMessage = this.hypervisor.logMessage.bind(this.hypervisor);
    }

    protected logMessage;
    protected instances: Record<string, T> = {};

    getInstance(id: string): T {
        return this.instances[id];
    }

    async shutdown() {
        for (let [id, instance] of Object.entries(this.instances)) {
            this._shutdownInstance(instance);
        }
        await timeoutPromise(15000, Promise.all(this.shutdownPromises), () => {
            this.logMessage("error", `At least one ${this.name} has not shutdown after 15 seconds. Taking drastic action.`);
            // TODO Drastic action
        });
    }

    @debounce({ timeToStability: 100, key_on: ([instance]) => typeof instance == 'string' ? instance : instance.id, unref: true })
    async reinitializeInstance(instance: string | T) {
        if (typeof instance == "string") {
            instance = this.instances[instance];
        }

        if (instance.state == 'stopping' || instance.state == 'stopped') return;

        const id = instance.id;
        await this._shutdownInstance(instance);
        await this._startInstance(id);
    }

    private _startupPromise: Promise<any>;
    private _startInstance(id: string, options?: C) {
        options ||= this.options.getInstanceConfig(id);

        let summary = this.options.summarizeInstance?.(options) || '';
        if (summary) summary = ` (${summary})`;
        this.logMessage("info", chalk`Starting ${this.name}: '${id}'${summary}...`)

        const instance: T = new this.options.Host({
            id,
            hypervisor: this.hypervisor,
            namespace: this,
        }, options);

        instance.on("lifecycle", (levent) => {
            this.emit("instance_lifecycle", instance, levent);
        })

        this.instances[id] = instance;

        const prom = this._startupPromise = (async () => {
            try {
                await instance._start();
            } catch (ex) {
                this.logMessage("error", `${this.name} '${id}' failed while starting up: `, ex)
                // We're intentionally forgoing immediate shutdown and cleanup - this allows the app's config watcher to remain active and restart the app
            }
            this._startupPromise = null;
        })();

        return prom;
    }

    private shutdownPromises = new Set<Promise<any>>();
    private _shutdownInstance(instance: string | T) {
        if (typeof instance == "string") {
            instance = this.instances[instance];
        }

        if (instance.state == 'stopping' || instance.state == 'stopped') return;

        const id = instance?.id;

        this.logMessage("info", `Stopping ${this.name}: '${id}'...`)

        if (instance != this.instances[id]) throw new Error(`Attempt to reinitialize an inactive ${this.name}`);

        delete this.instances[id];

        const prom = (async () => {
            try {
                // Handle starting state (should probably wait for it to finish and then stop it)
                if (this._startupPromise) {
                    try {
                        await timeoutPromise(5000, this._startupPromise, () => {
                            this.logMessage("warn", `Shutting down an app that never finished startup`);
                        })
                    } catch (ex) { }
                }
                await instance._shutdown();
            } catch (ex) {
                this.logMessage("error", `${this.name} '${id}' failed while shutting down: `, ex);
                throw ex;
            } finally {
                this.shutdownPromises.delete(prom)
            }
        })();

        this.shutdownPromises.add(prom);

        return prom;
    }

    sync(desired: Record<string, C>) {
        if (this.hypervisor.state != "running") return;

        const syncPromises: Promise<any>[] = [];

        const currentInstances = { ...this.instances }

        // TODO Better support for dependencies.
        //   Each app to await other_app.state == 'started'.
        //   Restart apps here when one of it's deps change
        //   (This may be resolved by the cross-call subsystem)

        // Kill running apps that shouldn't be
        for (let [id, instance] of Object.entries(currentInstances)) {
            if (!desired[id]) {
                const p = this._shutdownInstance(instance);
                syncPromises.push(p);
            }
        }

        // Notify apps of config changes. Allow app to decide if it can handle it, or if it needs a reboot.
        // (Each application manages this for itself)

        // Startup apps that should be running, but aren't
        for (let [id, options] of Object.entries(desired)) {
            if (!this.instances[id]) {
                const p = this._startInstance(id, options);
                syncPromises.push(p);
            }
        }

        return syncPromises
    }
}
