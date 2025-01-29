import path = require("path");
import { randomUUID } from "crypto";

import { _isComputingDerivation, computed, createAtom, onBecomeUnobserved } from "mobx";
import type { Atom, IComputedValue } from "mobx/dist/internal";

import { serializable } from "../common/util";
import { ResumablePromise } from "../runtime/resumable";
import { SerializeContext } from "../runtime/resumable/resumable_promise";
import { ApplicationInstance } from "./application_instance";
import { current } from "./current";
import { Hypervisor } from "./hypervisor";
import { logMessage } from "./logging";
import { PersistentStorage } from "./persistent_storage";

interface CrossAppCall {
    uuid: string;
    source_app: string;
    target_app: string;
    method: string;
    parameters?: any[];
    value?: any;
    result?: 'accept' | 'reject_raw' | 'reject_error';
    status: "pending" | "started" | "returning";
    awaited: boolean;
    start_by?: number;
}

export interface CrosscallConfig {
    pending_timeout?: number;
    fire_and_forget?: boolean;
}

export interface CrossqueryConfig {
    fallback?: "keep" | "throw" | "undefined" | (() => any);
    // reloading?: "keep" | "fallback" | "undefined" | (() => any);
}

export class UnknownCrossCallError extends Error { }
export class CrossCallError extends Error { }

class AppScopedStore {
    touchedCalls = new WeakSet<CrossAppCall>();
    pendingPromises: Record<string, CrossCallPromise> = {};
}

export class CrossCallStore {
    constructor(readonly hypervisor: Hypervisor) {
        this.storage = new PersistentStorage(path.join(hypervisor.operations_directory, ".cross_calls.jkv"))
    }

    private _appData = new WeakMap<ApplicationInstance, AppScopedStore>();

    private readonly storage: PersistentStorage;

    async load() {
        await this.storage.load();
    }

    private app_state_atoms: Record<string, ReturnType<typeof createAtom>> = {};
    private query_observers: Record<string, IComputedValue<any>> = {};

    crossQueryProperty(source: ApplicationInstance, dest: string | ApplicationInstance, property: string, config: CrossqueryConfig = {}) {
        const destApp = dest instanceof ApplicationInstance ? dest : this.hypervisor.getApplication(dest);

        if (!destApp) throw new Error(`Unknown application "${dest}"`);

        const _fallback = () => {
            if (config.fallback == "throw") {
                throw new Error(`Application "${destApp.uuid}" is not running`)
            } else if (config.fallback == "undefined") {
                return undefined;
            } else if (typeof config.fallback == "function") {
                return config.fallback();
            }
        }

        if (_isComputingDerivation()) {
            // Get/create Atom that listens to App state
            if (!this.app_state_atoms[destApp.uuid]) {
                let dispose;
                let hot = false;
                const atom = this.app_state_atoms[destApp.uuid] = createAtom(`AppState-${destApp.uuid}`, () => {
                    dispose = this.hypervisor.on("app_lifecycle", (app, levent) => {
                        const nhot = levent == "started";
                        if (nhot != hot) {
                            hot = nhot;
                            atom.reportChanged();
                        }
                    })
                }, () => {
                    delete this.app_state_atoms[destApp.uuid];
                    dispose?.();
                })
            }
            const atom = this.app_state_atoms[destApp.uuid];

            // Get/create a computed that observes atom and dest[property]
            const key = `${destApp.uuid}-${property}`;
            if (!this.query_observers[key]) {
                let lastValue;
                this.query_observers[key] = computed(() => {
                    atom.reportObserved();
                    const cdestapp = this.hypervisor.getApplication(destApp.uuid);
                    if (cdestapp.state != "started") {
                        if (config.fallback == "keep") return lastValue;
                        return _fallback();
                    } else {
                        lastValue = cdestapp.invoke(() => cdestapp.instance[property]);
                        // TODO Assert POJSO
                        return lastValue;
                    }
                }, {});

                onBecomeUnobserved(this.query_observers[key], () => {
                    delete this.query_observers[key];
                })
            }
            const computed_value = this.query_observers[key];
            return computed_value.get();
        } else {
            if (config.fallback == "keep") throw new Error("fallback: keep is only valid in @computeds");
            if (destApp.state == 'started') {
                // TODO Assert POJSO
                return destApp.invoke(() => destApp.instance[property]);
            } else {
                return _fallback();
            }
        }
    }

    makeCrossAppCall(source: ApplicationInstance, dest: string | ApplicationInstance, method: string, parameters: any[] = [], config: CrosscallConfig = {}) {
        const destApp = dest instanceof ApplicationInstance ? dest : this.hypervisor.getApplication(dest);

        if (!destApp) throw new Error(`Unknown application "${dest}"`);

        const cac: CrossAppCall = {
            uuid: randomUUID(),
            source_app: source.uuid,
            target_app: destApp.uuid,
            method,
            parameters,
            status: "pending",
            awaited: !config.fire_and_forget,
        }

        if (config.pending_timeout) {
            cac.start_by = Date.now() + config.pending_timeout;
        }

        this.writeCall(cac);

        if (destApp?.state == 'started') {
            this.dispatchCallInDest(cac, destApp);
        }

        return new CrossCallPromise(cac.uuid);
    }

    async handleAppStart(app: ApplicationInstance) {
        const appuuid = app.uuid;
        const appData = this.appData(app);
        const touches = appData.touchedCalls;

        // This is called _after_ Resumables have been loaded (so touchedCalls and pendingPromises have been rebuilt)

        for (let uuid of this.storage.keys) {
            const call = this.storage.getValue(uuid) as CrossAppCall;
            if (!call) continue;
            if (call.target_app == appuuid) {
                if (call.status == "pending") {
                    // Start "pending" items where app is dest
                    if (call.start_by && call.start_by < Date.now()) {
                        app.logMessage("debug", `Expired Pending CrossCall observed. Returning: ${JSON.stringify(call)}`);
                        this._awaiterCompleted(uuid, "reject", new Error(`Timedout while pending`));
                    } else {
                        app.logMessage("debug", `Pending CrossCall observed. Starting: ${JSON.stringify(call)}`);
                        this.dispatchCallInDest(call, app);
                    }
                } else if (call.status == "started") {
                    // Clean dead (not awaiting anything) "started" where app is dest
                    if (!touches.has(call)) {
                        app.logMessage("debug", `Dropping dead (not awaiting) CrossCall: ${JSON.stringify(call)}`);
                        this.writeCall(call.uuid, undefined);
                    }
                }
            } else if (call.source_app == appuuid) {
                if (call.status == "returning") {
                    // Clean dead (not awaited by anything) "returning" where app is source
                    if (!touches.has(call)) {
                        app.logMessage("debug", `Dropping dead (not awaited) CrossCall: ${JSON.stringify(call)}`);
                        this.writeCall(call.uuid, undefined);
                    }
                }
            }
        }
    }

    _awaiterCompleted(call_uuid: string, status: "accept" | "reject", value) {
        let call = this.storage.getValue<CrossAppCall>(call_uuid);
        if (!call) {
            logMessage("error", "Received CrossAppCall completion for an unknown call");
            return
        }

        // Fire-and-forget mode
        if (!call.awaited) {
            this.writeCall(call_uuid, undefined);
            return;
        }

        call = { ...call }
        if (status == "accept") {
            call.result = "accept";
            if (!serializable(value, [])) {
                logMessage("error", `CrossAppCall to ${call.target_app}.${call.method}() return non-JSON-serialiable`, value);
                call.result = "reject_error";
                value = "Cross-App Call returns must be JSON serializable";
            }
        } else {
            if (value instanceof Error) {
                logMessage("error", `CrossAppCall ${call.source_app}->${call.target_app}.${call.method}() threw:`, value);
                value = String(value);
                call.result = "reject_error";
            } else {
                call.result = "reject_raw";
            }
        }
        call.value = value;
        call.status = "returning";

        const destApp = this.hypervisor.getApplication(call.source_app);
        if (destApp && destApp.state == 'started') {
            const adata = this.appData(destApp);
            const prom = adata.pendingPromises[call_uuid];

            if (prom) {
                this.dispatchCallResolution(call, prom);
                return;
            }
        }

        this.writeCall(call);
    }

    _setClientPromise(app: ApplicationInstance, call_uuid: string, prom: CrossCallPromise) {
        const call = this.storage.getValue<CrossAppCall>(call_uuid);
        if (!call) {
            prom.reject(new UnknownCrossCallError());
        } else if (call.status == "returning") {
            this.dispatchCallResolution(call, prom);
        } else {
            this.appData(app).pendingPromises[call_uuid] = prom;
        }
    }

    protected appData(by: ApplicationInstance) {
        if (!this._appData.has(by)) {
            this._appData.set(by, new AppScopedStore());
        }
        return this._appData.get(by);
    }

    _markCallTouched(by: ApplicationInstance, call_uuid: string) {
        const call = this.storage.getValue<CrossAppCall>(call_uuid);
        if (!call) return;
        this.appData(by).touchedCalls.add(call);
    }

    private dispatchCallInDest(call: CrossAppCall, dest: ApplicationInstance) {
        if (call.status != "pending") return;

        call = { ...call };
        call.status = 'started';
        this.writeCall(call);

        dest.invoke(() => {
            try {
                const mthd = dest.instance[call.method] as Function;
                if (!mthd) {
                    throw `No method '${call.method}'`;
                }
                const iret = mthd.call(dest.instance, ...call.parameters);
                if (iret.then) {
                    new CrossCallWrapper(iret, call.uuid);
                } else {
                    this._awaiterCompleted(call.uuid, "accept", iret);
                }
            } catch (ex) {
                this._awaiterCompleted(call.uuid, "reject", ex);
            }
        })
    }

    private dispatchCallResolution(call: CrossAppCall, prom: CrossCallPromise) {
        if (call.result == "accept") {
            prom.resolve(call.value);
        } else if (call.result == "reject_error") {
            prom.reject(new CrossCallError(call.value));
        } else {
            prom.reject(call.value);
        }
        this.writeCall(call.uuid, undefined);
    }

    private writeCall(call: CrossAppCall)
    private writeCall(call_uuid: string, call: CrossAppCall)
    private writeCall(call_uuid: string | CrossAppCall, call?: CrossAppCall) {
        if (typeof call_uuid == 'object') {
            call = call_uuid;
            call_uuid = call.uuid;
        }
        this.storage.setValue(call_uuid, call, { min_time_to_disk: 0, max_time_to_disk: 1 });
    }

    async dispose() {
        await this.storage.dispose();
    }
}

/**
 * Wraps a Promise in the CrossCall Server/Dest. Handles awaiting the server/dest logic and returning the result to CrossCallStore
 */
class CrossCallWrapper extends ResumablePromise<any> {
    constructor(readonly await_for: PromiseLike<any>, readonly call_uuid: string) {
        super();

        if (await_for instanceof ResumablePromise) {
            await_for.then(this.resolve.bind(this), this.reject.bind(this), this);
        } else {
            await_for.then(this.resolve.bind(this), this.reject.bind(this));
        }

        current.hypervisor.crossCallStore._markCallTouched(current.application, call_uuid);

        this.then(
            (result) => current.hypervisor.crossCallStore._awaiterCompleted(this.call_uuid, "accept", result),
            (err) => current.hypervisor.crossCallStore._awaiterCompleted(this.call_uuid, "reject", err),
            true
        );
    }

    static {
        ResumablePromise.defineClass<CrossCallWrapper>({
            type: 'cross-call-awaiter',
            resumer: (data, { require }) => {
                return new this(require(data.await_for), data.call_uuid);
            },
        })
    }

    protected awaiting_for(): Iterable<PromiseLike<any>> {
        return [this.await_for]
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('cross-call-awaiter');
        ctx.side_effects(true);
        return {
            call_uuid: this.call_uuid,
            await_for: ctx.ref(this.await_for),
        }
    }
}

/**
 * ResumablePromise returned when making a CrossAppCall. Links with CrossCallStore and waits for the call to return
 */
class CrossCallPromise extends ResumablePromise<any> {
    constructor(readonly call_uuid: string) {
        super();

        this.application = current.application;
        current.hypervisor.crossCallStore._markCallTouched(current.application, call_uuid);

        this.do_unsuspend();
    }

    readonly application: ApplicationInstance;

    static {
        ResumablePromise.defineClass<CrossCallPromise>({
            type: 'cross-call-awaitee',
            resumer: (data) => {
                return new this(data.call_uuid);
            },
        })
    }

    resolve(arg: any): void {
        return super.resolve(arg)
    }
    reject(arg: any): void {
        return super.resolve(arg)
    }

    protected do_unsuspend() {
        current.hypervisor.crossCallStore._setClientPromise(this.application, this.call_uuid, this);
    }

    protected do_suspend() {
        current.hypervisor.crossCallStore._setClientPromise(this.application, this.call_uuid, null);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('cross-call-awaitee');
        ctx.side_effects(false);
        return {
            call_uuid: this.call_uuid,
        }
    }
}
