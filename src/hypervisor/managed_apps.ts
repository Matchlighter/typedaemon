import { AsyncLocalStorage } from "async_hooks";
import chalk from "chalk";
import { ListenerSignature, TypedEmitter } from "tiny-typed-emitter";
import { ConditionalKeys, Merge } from "type-fest";

import { debounce } from "@matchlighter/common_library/limit";
import { upcaseFirstChar } from "@matchlighter/common_library/strings";

import { LifecycleHelper } from "../common/lifecycle_helper";
import type { StartCause } from "../common/shared_types";
import { timeoutPromise } from "../common/util";
import type { AppLifecycle } from "./application_instance";
import { Hypervisor } from "./hypervisor";
import { ExtendedLoger, LogLevel, LoggerOptions, createDomainLogger } from "./logging";
import type { LogSource } from "./log_tap";

interface LifecycleEvents {
    // started: () => void;
    // stopping: () => void;
    // stopped: () => void;
    lifecycle: (state: AppLifecycle) => void;
    issues: (issues: ReadonlyMap<string, InstanceIssue>) => void;
}

/** A standing problem with an instance that needs attention (eg for display in a UI) */
export interface InstanceIssue {
    level: "warn" | "error";
    message: string;
    since: number;
}

export type { StartCause };

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
    /** Who the instance's loggers speak for: their output is also kept for the dashboard */
    source?: LogSource;
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

    /** Why this instance exists in place of a previous one; undefined for a plain (first or after-stop) start */
    startCause?: StartCause;
    /** Dotted config paths whose change restarted this instance (with `startCause: 'config_change'`), where known */
    startChanged?: string[];

    abstract _start(): Promise<any>

    /** Enter `stopping` (once). Called as soon as a shutdown is requested, so a pending start does not hide it, and an in-flight start aborts */
    beginShutdown() {
        if (this.state === 'stopping' || this.state === 'stopped') return;
        this.transitionState('stopping');
    }

    async _shutdown() {
        this.beginShutdown();
        await this.invoke(() => this.cleanups.cleanup())
        this.transitionState('stopped')

        this._logger?.close();
        this._userSpaceLogger?.close();
    }

    logMessage(level: LogLevel, ...rest) {
        this.logger.logMessage(level, rest);
    }

    logClientMessage(level: LogLevel, ...rest) {
        this.userSpaceLogger.logMessage(level, rest);
    }

    protected _updateLogConfig() {
        const { tag: domain, manager, user, ...rest } = this.loggerOptions();

        this._logger?.close();
        this._userSpaceLogger?.close();

        this._logger = createDomainLogger({
            level: "warn",
            domain,
            channel: 'manager',
            ...rest,
            ...manager,
        })

        this._userSpaceLogger = createDomainLogger({
            level: "debug",
            domain,
            channel: 'user',
            ...rest,
            ...user,
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
    private _stateSince = Date.now();
    protected transitionState(nstate: AppLifecycle) {
        this._state = nstate;
        this._stateSince = Date.now();
        this.logClientMessage("lifecycle", upcaseFirstChar(nstate))
        // @ts-ignore
        this.emit("lifecycle", nstate);
        // @ts-ignore
        // this.emit(nstate as any);
    }
    get state() { return this._state }
    /** Epoch ms of the last lifecycle transition (instance creation, until the first one) */
    get stateSince() { return this._stateSince }

    private _issues = new Map<string, InstanceIssue>();
    get issues(): ReadonlyMap<string, InstanceIssue> { return this._issues }

    /** Flag (or update) a standing issue, identified by `key` */
    raiseIssue(key: string, level: InstanceIssue["level"], message: string) {
        const existing = this._issues.get(key);
        if (existing?.level == level && existing.message == message) return;
        this._issues.set(key, { level, message, since: existing?.since ?? Date.now() });
        // @ts-ignore
        this.emit("issues", this._issues);
    }

    clearIssue(key: string) {
        if (!this._issues.delete(key)) return;
        // @ts-ignore
        this.emit("issues", this._issues);
    }

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
    /** A runtime stop override was set or cleared for this id */
    override_changed: (id: string) => void;
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

    listInstances(): T[] {
        return Object.values(this.instances);
    }

    private stoppedOverrides = new Set<string>();

    // Instances started with an explicit config (not in the config file); `sync` leaves them alone
    private dynamicConfigs = new Map<string, C>();

    /** True if `id` was started with an explicit config (see `startInstance`) */
    isDynamic(id: string) { return this.dynamicConfigs.has(id) }

    private configFor(id: string): C | undefined {
        return this.dynamicConfigs.get(id) ?? this.options.getInstanceConfig(id);
    }

    /** Stopped at runtime (e.g. from the dashboard): `sync` leaves it alone until the override is cleared */
    isStoppedOverride(id: string) { return this.stoppedOverrides.has(id) }

    private setOverride(id: string, stopped: boolean) {
        if (this.stoppedOverrides.has(id) === stopped) return;
        if (stopped) this.stoppedOverrides.add(id); else this.stoppedOverrides.delete(id);
        this.emit("override_changed", id);
    }

    /** Forget the overrides of `ids` (their config changed). Returns those that were overridden. */
    clearOverrides(ids: Iterable<string>): string[] {
        const cleared = [...ids].filter(id => this.stoppedOverrides.has(id));
        for (const id of cleared) this.setOverride(id, false);
        return cleared;
    }

    /**
     * Shut an instance down and keep it down until `startInstance`/`restartInstance` or its config entry changes.
     * An instance that was started with an explicit config is forgotten entirely.
     */
    async stopInstance(id: string) {
        const dynamic = this.dynamicConfigs.has(id);
        if (dynamic) this.dynamicConfigs.delete(id); else this.setOverride(id, true);
        const instance = this.instances[id];
        if (instance) await this._shutdownInstance(instance);
    }

    /**
     * Clear any override and start the instance if it is not running. Throws if the id is not in the config.
     *
     * With `config`, start an instance that is not in the config file, using that config. Throws if `id` is in the
     * config file or already running. It lives until stopped (or the Hypervisor shuts down); config reloads leave it alone.
     */
    async startInstance(id: string, config?: C) {
        if (config) {
            if (this.options.getInstanceConfig(id)) throw new Error(`${this.name} '${id}' is already configured`);
            if (this.instances[id]) throw new Error(`${this.name} '${id}' is already running`);
            this.dynamicConfigs.set(id, config);
            try {
                await this._startInstance(id, config);
            } catch (ex) {
                this.dynamicConfigs.delete(id);
                throw ex;
            }
            return;
        }
        const options = this.configFor(id);
        if (!options) throw new Error(`${this.name} '${id}' is not configured`);
        this.setOverride(id, false);
        if (!this.instances[id]) await this._startInstance(id, options);
    }

    /** Shut down (if running) and start a fresh instance, immediately (no debounce) */
    async restartInstance(id: string, cause: StartCause = 'manual') {
        const options = this.configFor(id);
        if (!options) throw new Error(`${this.name} '${id}' is not configured`);
        this.setOverride(id, false);
        await this._restart(id, this.instances[id], cause, options);
    }

    /** Shut `instance` down (if any) then start a fresh one, tagged with `cause` */
    private async _restart(id: string, instance: T | undefined, cause: StartCause | undefined, options?: C, changed?: string[]) {
        if (instance) await this._shutdownInstance(instance);
        await this._startInstance(id, options, cause, changed);
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
    async reinitializeInstance(instance: string | T, cause?: StartCause, changed?: string[]) {
        if (typeof instance == "string") {
            instance = this.instances[instance];
        }

        if (instance.state == 'stopping' || instance.state == 'stopped') return;

        await this._restart(instance.id, instance, cause, undefined, changed);
    }

    private _startupPromise: Promise<any>;

    // Tail of the queue of exclusive-access work per id; starts wait for it
    private exclusive = new Map<string, Promise<void>>();
    // Starts that got past the exclusive gate and are still running
    private pastGate = new Map<string, { instance: T; done: Promise<void> }>();

    private async waitForExclusiveAccess(id: string) {
        let tail: Promise<void> | undefined;
        while ((tail = this.exclusive.get(id))) await tail;
    }

    /**
     * Run `fn` while nothing can start or shut down an instance `id` (they wait until `fn` is done), so it may safely use files the
     * instance owns (eg its persisted storage). `live` is the instance if it is up or was already starting (its start is
     * awaited first); it is undefined when there is none, in which case no one else has the files open.
     * Work for one id runs one at a time. `fn` must not start/stop/restart the instance (that would wait on itself).
     */
    async withExclusiveAccess<R>(id: string, fn: (live: T | undefined) => Promise<R> | R): Promise<R> {
        const prev = this.exclusive.get(id) ?? Promise.resolve();
        let release: () => void;
        const mine = new Promise<void>(r => { release = r });
        const tail = prev.then(() => mine);
        this.exclusive.set(id, tail);
        await prev;
        try {
            await this.pastGate.get(id)?.done;
            return await fn(this.startedInstance(id));
        } finally {
            release!();
            tail.then(() => { if (this.exclusive.get(id) === tail) this.exclusive.delete(id) });
        }
    }

    /** The registered instance, unless it is still waiting at the exclusive gate (then it owns nothing yet) */
    private startedInstance(id: string): T | undefined {
        const instance = this.instances[id];
        return instance && instance.state !== 'initializing' ? instance : undefined;
    }

    private _startInstance(id: string, options?: C, cause?: StartCause, changed?: string[]) {
        options ||= this.configFor(id);

        let summary = this.options.summarizeInstance?.(options) || '';
        if (summary) summary = ` (${summary})`;
        this.logMessage("info", chalk`Starting ${this.name}: '${id}'${summary}...`)

        const instance: T = new this.options.Host({
            id,
            hypervisor: this.hypervisor,
            namespace: this,
        }, options);

        instance.startCause = cause;
        if (changed?.length) instance.startChanged = changed;
        instance.on("lifecycle", (levent) => {
            this.emit("instance_lifecycle", instance, levent);
        })

        this.instances[id] = instance;

        const prom = this._startupPromise = (async () => {
            await this.waitForExclusiveAccess(id);
            let markDone: () => void;
            this.pastGate.set(id, { instance, done: new Promise<void>(r => { markDone = r }) });
            try {
                await instance._start();
            } catch (ex) {
                this.logMessage("error", `${this.name} '${id}' failed while starting up: `, ex.message);
                // We're intentionally forgoing immediate shutdown and cleanup - this allows the app's config watcher to remain active and restart the app
            }
            this._startupPromise = null;
            if (this.pastGate.get(id)?.instance === instance) this.pastGate.delete(id);
            markDone!();
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
                // Don't tear down files that exclusive work is using
                await this.waitForExclusiveAccess(id);
                // Show (and enforce) `stopping` now: a start still in flight aborts at its next checkpoint instead of running on for up to the wait below
                instance.beginShutdown();
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
                this.logMessage("error", `${this.name} '${id}' failed while shutting down: `, ex.message);
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
            if (!desired[id] && !this.dynamicConfigs.has(id)) {
                const p = this._shutdownInstance(instance);
                syncPromises.push(p);
            }
        }

        // Notify apps of config changes. Allow app to decide if it can handle it, or if it needs a reboot.
        // (Each application manages this for itself)

        // Startup apps that should be running, but aren't
        for (let [id, options] of Object.entries(desired)) {
            if (!this.instances[id] && !this.stoppedOverrides.has(id)) {
                const p = this._startInstance(id, options);
                syncPromises.push(p);
            }
        }

        return syncPromises
    }
}
