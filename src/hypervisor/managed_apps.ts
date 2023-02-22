import chalk = require("chalk");
import { Merge } from "type-fest";

import { debounce } from "../common/limit";
import { colorLogLevel, timeoutPromise } from "../common/util";
import { Hypervisor } from "./hypervisor";
import { ListenerSignature, TypedEmitter } from "tiny-typed-emitter";
import { AppLifecycle } from "./application_instance";
import { upcaseFirstChar } from "@matchlighter/common_library/cjs/strings";
import { ConsoleMethod } from "./vm";

interface LifecycleEvents {
    // started: () => void;
    // stopping: () => void;
    // stopped: () => void;
    lifecycle: (state: AppLifecycle) => void;
}

export const HyperWrapper = Symbol("Hypervisor Application");

export class BaseInstanceClient<I extends BaseInstance<C>, C = any> {
    constructor(hyper_wrapper: I) {
        this[HyperWrapper] = hyper_wrapper;
    }

    initialize() { }
    shutdown() { }

    [HyperWrapper]: I;
}

interface InstanceContext {
    hypervisor: Hypervisor;
    id: string;
    namespace: AppNamespace;
}

export abstract class BaseInstance<C, const L extends ListenerSignature<L> = {}> extends TypedEmitter<Merge<L, LifecycleEvents>> {
    constructor(readonly context: InstanceContext, readonly options: C) {
        super()
    }

    get id() { return this.context.id }
    get hypervisor() { return this.context.hypervisor }
    get namespace() { return this.context.namespace }

    protected logPrefix: string;

    abstract _start(): Promise<any>
    abstract _shutdown(): Promise<any>

    logMessage(level: ConsoleMethod | 'system' | 'lifecycle', ...rest) {
        console.log(chalk`{blue [Task: ${this.id}]} - ${colorLogLevel(level)} -`, ...rest);
    }

    private _state: AppLifecycle = "initializing";
    protected transitionState(nstate: AppLifecycle) {
        this._state = nstate;
        this.logMessage("lifecycle", upcaseFirstChar(nstate))
        // @ts-ignore
        this.emit("lifecycle", nstate);
        // @ts-ignore
        // this.emit(nstate as any);
    }
    get state() { return this._state }
}

export interface BaseInstanceConfig {

}

export interface InstanceConstructor<T extends BaseInstance<C, any>, C extends BaseInstanceConfig> {
    new(context: InstanceContext, options: C): T;
}

export class AppNamespace<C extends BaseInstanceConfig = BaseInstanceConfig, T extends BaseInstance<C> = BaseInstance<C>> {
    constructor(
        readonly hypervisor: Hypervisor,
        readonly name: string,
        readonly options: {
            Host: InstanceConstructor<T, C>,
            getInstanceConfig: (id: string) => C,
            summarizeInstance?: (config: C) => string,
        },
    ) {

    }

    protected logMessage = this.hypervisor.logMessage.bind(this.hypervisor);
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

    @debounce({ timeToStability: 100, key_on: ([instance]) => typeof instance == 'string' ? instance : instance.id })
    async reinitializeInstance(instance: string | T) {
        if (typeof instance == "string") {
            instance = this.instances[instance];
        }
        const id = instance.id;
        await this._shutdownInstance(instance);
        await this._startInstance(id);
    }

    private _startInstance(id: string, options?: C) {
        options ||= this.options.getInstanceConfig(id);

        let summary = this.options.summarizeInstance?.(options) || '';
        if (summary) summary = ` (${summary})`;
        this.logMessage("info", chalk`Starting ${this.name}: '${id}'${summary}...`)

        const instance = new this.options.Host({
            id,
            hypervisor: this.hypervisor,
            namespace: this,
        }, options);
        this.instances[id] = instance;
        return instance._start().catch((ex) => {
            this.logMessage("error", `${this.name} '${id}' failed while starting up: `, ex)
            return this._shutdownInstance(instance).catch(() => { });
        });
    }

    private shutdownPromises = new Set<Promise<any>>();
    private _shutdownInstance(instance: string | T) {
        if (typeof instance == "string") {
            instance = this.instances[instance];
        }

        const id = instance?.id;

        this.logMessage("info", `Stopping ${this.name}: '${id}'...`)

        if (instance != this.instances[id]) throw new Error(`Attempt to reinitialize an inactive ${this.name}`);

        delete this.instances[id];

        const prom = Promise.resolve(instance._shutdown());
        this.shutdownPromises.add(prom);
        // TODO Set a timer to check that it actually stopped?
        return prom.finally(() => this.shutdownPromises.delete(prom)).catch((ex) => {
            this.logMessage("error", `${this.name} '${id}' failed while shutting down: `, ex);
            throw ex;
        })
    }

    sync(desired: Record<string, C>) {
        if (this.hypervisor.state != "running") return;

        const syncPromises: Promise<any>[] = [];

        const currentInstances = { ...this.instances }

        // TODO Better support for dependencies.
        //   Each app to await other_app.state == 'started'.
        //   Restart apps here when one of it's deps change

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
