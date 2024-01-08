import path = require("path");
import { randomUUID } from "crypto";

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
}

export class UnknownCrossCallError extends Error { }
export class CrossCallError extends Error { }

export class CrossCallStore {
    constructor(readonly hypervisor: Hypervisor) {
        this.storage = new PersistentStorage(path.join(hypervisor.operations_directory, ".cross_calls.jkv"))
    }

    private appTouchedCalls = new WeakMap<ApplicationInstance, WeakSet<CrossAppCall>>();

    private client_promises: Record<string, CrossCallPromise> = {};
    private readonly storage: PersistentStorage;

    async load() {
        await this.storage.load();
    }

    // TODO Add pending timeout support
    makeCrossAppCall(source: ApplicationInstance, dest: string, method: string, parameters: any[] = []) {
        const destApp = this.hypervisor.getApplication(dest);

        if (!destApp) throw new Error(`Unknown application "${dest}"`);

        const cac: CrossAppCall = {
            uuid: randomUUID(),
            source_app: source.uuid,
            target_app: dest,
            method,
            parameters,
            status: "pending",
        }

        this.writeCall(cac);

        if (destApp?.state == 'started') {
            this.dispatchCallInDest(cac, destApp);
        }

        return new CrossCallPromise(cac.uuid);
    }

    async handleAppStart(app: ApplicationInstance) {
        const appuuid = app.uuid;
        const touches = this.appTouches(app);

        for (let uuid of this.storage.keys) {
            const call = this.storage.getValue(uuid) as CrossAppCall;
            if (!call) continue;
            if (call.target_app == appuuid) {
                if (call.status == "pending") {
                    // Start "pending" items where app is dest
                    app.logMessage("debug", `Pending CrossCall observed. Starting: ${JSON.stringify(call)}`);
                    this.dispatchCallInDest(call, app);
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

        const prom = this.client_promises[call_uuid];
        if (prom) {
            this.dispatchCallResolution(call, prom);
        } else {
            this.writeCall(call);
        }
    }

    _setClientPromise(call_uuid: string, prom: CrossCallPromise) {
        const call = this.storage.getValue<CrossAppCall>(call_uuid);
        if (!call) {
            prom.reject(new UnknownCrossCallError());
        } else if (call.status == "returning") {
            this.dispatchCallResolution(call, prom);
        } else {
            this.client_promises[call_uuid] = prom;
        }
    }

    private appTouches(by: ApplicationInstance) {
        if (!this.appTouchedCalls.has(by)) {
            this.appTouchedCalls.set(by, new WeakSet());
        }
        return this.appTouchedCalls.get(by);
    }

    _markCallTouched(by: ApplicationInstance, call_uuid: string) {
        const call = this.storage.getValue<CrossAppCall>(call_uuid);
        if (!call) return;
        this.appTouches(by).add(call);
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

        current.hypervisor.crossCallStore._markCallTouched(current.application, call_uuid);

        this.do_unsuspend();
    }

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
        current.hypervisor.crossCallStore._setClientPromise(this.call_uuid, this);
    }

    protected do_suspend() {
        current.hypervisor.crossCallStore._setClientPromise(this.call_uuid, null);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('cross-call-awaitee');
        ctx.side_effects(false);
        return {
            call_uuid: this.call_uuid,
        }
    }
}
