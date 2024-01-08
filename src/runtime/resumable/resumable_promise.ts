
import { ExtensiblePromise } from "@matchlighter/common_library/promises";
import { ResumableStore } from ".";
import { serializable } from "../../common/util";
import { current } from "../../hypervisor/current";
import { logMessage } from "../../hypervisor/logging";

export interface FullySerializedResumable {
    id: string;
    type: string;
    dependencies?: string[];
    sideeffect_free?: boolean;
    data: any;
}

type PromiseReference = number;

interface ResumerContext {
    require: (key: PromiseReference) => ResumablePromise;
    metadata?: FullySerializedResumable;
}
export interface SerializeContext {
    ref: (rp: PromiseLike<any>) => PromiseReference;
    set_type: (type: string) => void;
    side_effects: (has: boolean) => void;
}

interface Resumer<T extends ResumablePromise, S = ReturnType<T['serialize']>> {
    (data: S, context: ResumerContext): T;
}

interface ResumablePromiseClass<C extends ResumablePromise<any> = ResumablePromise> {
    type: string;
    resumer: Resumer<C>;
    // /** pure resumables are just waiters - there are no side-effects, so if nothing depends on one, it can just be dropped */
    // pure?: boolean;
}

export interface CanSuspendContext {
    link: (prom: PromiseLike<any>) => void
}

export abstract class ResumablePromise<T = any> extends ExtensiblePromise<T> {
    static all<const T extends readonly Promise<any>[]>(promises: T) {
        return ResumableAllPromise.create(promises as any) as ResumableAllPromise<T>;
    }

    static allSettled<const T extends readonly Promise<any>[]>(promises: T) {
        return ResumableAllSettledPromise.create(promises as any) as ResumableAllSettledPromise<T>;
    }

    private static classifications: Record<string, ResumablePromiseClass> = {};
    static defineClass<C extends ResumablePromise>(cfg: ResumablePromiseClass<C>, cls?: C) {
        this.classifications[cfg.type] = cfg;
    }

    static resumePromises(data: FullySerializedResumable[]) {
        const by_id: Record<number, FullySerializedResumable> = {};
        const loaded_promises: Record<string, ResumablePromise> = {};

        const load = (key: string) => {
            if (!key) return null;

            let loaded = loaded_promises[key];

            if (!loaded) {
                const pdata = by_id[key] as FullySerializedResumable;
                if (!pdata) throw new Error(`No ResumablePromise with key ${key} in file`);
                const classif = this.classifications[pdata.type];

                const cdata = pdata.data;

                try {
                    loaded = classif.resumer(cdata, {
                        require: (dep_index) => load(pdata.dependencies[dep_index]),
                        metadata: pdata,
                    });
                } catch (ex) {
                    loaded = new FailedResume(
                        ex,
                        pdata,
                        pdata.dependencies.map(dep => load(dep))
                    );
                }

                loaded_promises[key] = loaded;
            }

            return loaded;
        }

        for (let v of data) by_id[v.id] = v;
        for (let [k, v] of Object.entries(by_id)) {
            try {
                load(k);
            } catch (ex) { }
        }

        return loaded_promises
    }

    static serialize_all(promises: ResumablePromise[] | Generator<ResumablePromise>) {
        // Discovery Phase
        const promise_to_serialized = new Map<ResumablePromise, FullySerializedResumable>();

        function discover(obj: ResumablePromise) {
            if (!obj) return;
            if (promise_to_serialized.has(obj)) return;

            const id = String(cuid++);

            const srepr: FullySerializedResumable = {
                id,
                type: null,
                dependencies: [],
                sideeffect_free: false,
                data: {},
            };
            promise_to_serialized.set(obj, srepr as any);

            const context: SerializeContext = {
                ref: (prom) => {
                    if (!prom) return null;
                    if (!(prom instanceof ResumablePromise)) {
                        // Non-resumable promises shouldn't reach this point. If they do, that means
                        //   `can_suspend` logic is missing them
                        prom = new SettledPromise({ result: "reject_error", value: "Cannot suspend non-resumable Promise" });
                    }
                    const rp = prom as ResumablePromise;
                    discover(rp);
                    const dep_entry = promise_to_serialized.get(rp);
                    srepr.dependencies.push(dep_entry.id);
                    return srepr.dependencies.length - 1;
                },
                side_effects: (has: boolean) => {
                    srepr.sideeffect_free = !has;
                },
                set_type: (type: string) => {
                    srepr.type = type;
                }
            }

            // If not suspended, convert to error SettledPromise
            if (!obj.suspended || obj.force_suspended) {
                obj = new SettledPromise({ result: "reject_error", value: "Promise would not suspend" });
            }

            // Serialize settled promises as SettledPromise
            if (obj.settled && !(obj instanceof SettledPromise)) {
                obj = SettledPromise.for_resumable(obj);
            }

            let sdata;
            try {
                sdata = obj.serialize(context);
                JSON.stringify(sdata);
            } catch (ex) {
                logMessage("error", "Failed to serialize resumable", ex);

                // If a serialization error occurs, store as error-type SettledPromise
                sdata = new SettledPromise({ result: "reject_error", value: "Error serializing promise during suspension" }).serialize(context);
            }
            srepr.data = sdata;

            for (let aw of obj.awaited_by()) {
                discover(aw);
            }
        }

        let cuid = 0;
        for (let rp of promises) {
            discover(rp);
        }

        // Commit Phase
        const serialized_by_id: Record<string, FullySerializedResumable> = {};
        for (let [promise, serialized] of promise_to_serialized.entries()) {
            serialized_by_id[serialized.id] = serialized;
        }

        const commit_ids = new Set<string>();

        function commit_item(id: string) {
            if (commit_ids.has(id)) return;

            commit_ids.add(id);

            const info = serialized_by_id[id];
            for (let depid of info.dependencies) {
                commit_item(depid);
            }
        }

        for (let [promise, serialized] of promise_to_serialized.entries()) {
            if (!serialized.sideeffect_free) {
                commit_item(serialized.id);
            }
        }

        return [...commit_ids].map(id => serialized_by_id[id])
    }

    static get_store = () => {
        return current.application.resumableStore;
    }

    constructor() {
        super();
        this._store = ResumablePromise.get_store();
        this._store.track(this);
    }

    protected readonly _store: ResumableStore;

    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>,
        onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>,
        resumable: ResumablePromise<any> | boolean = false,
    ): Promise<TResult1 | TResult2> {
        if (!resumable) {
            this.has_non_resumable_awaiters = true;
        } else if (resumable instanceof ResumablePromise) {
            this.resumable_awaiters.push(resumable);
        }
        return super.then(onfulfilled, onrejected);
    }

    catch<TResult1 = T>(
        onrejected?: (reason: any) => TResult1 | PromiseLike<TResult1>,
        resumable: ResumablePromise<any> | boolean = false,
    ): Promise<TResult1> {
        return this.then(null, onrejected, resumable);
    }

    finally(
        handle: () => void,
        resumable: ResumablePromise<any> | boolean = false,
    ) {
        return this.then(handle, async (err) => {
            await handle();
            throw err;
        }, resumable);
    }

    private _promise_state: "accepted" | "rejected";
    private _promise_result: any;
    get settled() { return !!this._promise_state }
    get promise_state() { return this._promise_state }
    get promise_value() { return this._promise_result }

    protected resolve(arg: T) {
        this._promise_state = "accepted";
        this._promise_result = arg;
        return this._resolve(arg);
    }

    protected reject(reason: any) {
        this._promise_state = "rejected";
        this._promise_result = reason;
        return this._reject(reason);
    }

    protected awaited_by() {
        return this.resumable_awaiters;
    }

    protected awaiting_for(): Iterable<PromiseLike<any>> {
        return [];
    }

    protected can_suspend() {
        return true;
    }

    private has_non_resumable_awaiters = false;
    private resumable_awaiters: ResumablePromise<any>[] = [];

    private _suspended = false;
    get suspended() { return this._suspended }

    protected full_tree(history?: Set<PromiseLike<any>>) {
        history ||= new Set();
        if (history.has(this)) return;

        history.add(this);

        for (let p of this.awaited_by()) {
            if (p instanceof ResumablePromise) {
                p.full_tree(history);
            } else {
                history.add(p);
            }
        }
        for (let p of this.awaiting_for()) {
            if (p instanceof ResumablePromise) {
                p.full_tree(history);
            } else {
                history.add(p);
            }
        }

        return history;
    }

    protected do_suspend() { }
    protected do_unsuspend() { }

    private _force_suspended = false;
    get force_suspended() { return this._force_suspended }

    force_suspend() {
        this._suspended = true;
        this._force_suspended = true;
        this.do_suspend();
    }

    /**
     * Re-determine if this Promise should be paused or running
     */
    compute_paused() {
        let desired_pause = true;

        if (this._store.state == "active") {
            desired_pause = false;
        } else {
            if (this.settled) {
                desired_pause = SettledPromise.can_suspend(this);
            } else {
                if (this.has_non_resumable_awaiters) {
                    desired_pause = false;
                }
                for (let awaiter of this.awaited_by()) {
                    if (!awaiter.suspended) desired_pause = false;
                }
                for (let awaitee of this.awaiting_for()) {
                    if (!(awaitee instanceof ResumablePromise)) {
                        desired_pause = false;
                    }
                }
                if (!this.can_suspend()) {
                    desired_pause = false;
                }
            }
        }

        if (desired_pause != this.suspended) {
            this._store.computeBatcher.perform(() => {
                this._suspended = desired_pause;
                if (this.suspended) {
                    this.do_suspend();
                } else {
                    this.do_unsuspend();
                }

                // Re-assess to the right
                for (let awaitee of this.awaiting_for()) {
                    if (awaitee instanceof ResumablePromise) awaitee.compute_paused();
                }
            })
        }
    }

    abstract serialize(ctx: SerializeContext): any;
}

export class ResumableAllPromise<const T extends readonly PromiseLike<any>[]> extends ResumablePromise<T> {
    constructor(protected entries: PromiseLike<any>[]) {
        super();
        this.followPromises();
    }

    static create(promises: any[]) {
        return new this(promises.map(p => {
            if (p.then) {
                return p;
            } else {
                return new SettledPromise({ result: 'accept', value: p });
            }
        }))
    }

    static {
        ResumablePromise.defineClass<ResumableAllPromise<any>>({
            type: 'all',
            resumer: (data, { require }) => {
                const entries = data.entries.map((e) => require(e));
                return new this(entries);
            },
        })
    }

    protected followPromises() {
        const entries = this.entries;
        trackPromiseList(entries, (setlled) => {
            if (setlled.promise_state != 'accepted') this.reject(setlled.promise_value);

            if (allSettled(entries)) {
                this.resolve_from_entries();
            } else {
                this.compute_paused();
            }
        })
    }

    protected resolve_from_entries() {
        this.resolve(this.entries.map(fp => {
            return (fp as SettledPromise<any>).promise_value;
        }) as any);
    }

    protected awaiting_for() {
        return this.entries;
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('all');
        ctx.side_effects(false);
        return {
            entries: this.entries.map(e => ctx.ref(e)),
        }
    }
}

type PromiseList = readonly PromiseLike<any>[]
type MappedPromiseSettledReult<T extends PromiseList> = { [K in keyof T]: PromiseSettledResult<T[K]> };

export class ResumableAllSettledPromise<const T extends PromiseList> extends ResumablePromise<MappedPromiseSettledReult<T>> {
    constructor(protected entries: PromiseLike<any>[]) {
        super();
        this.followPromises();
    }

    static create(promises: any[]) {
        return new this(promises.map(p => {
            if (p.then) {
                return p;
            } else {
                return new SettledPromise({ result: 'accept', value: p });
            }
        }))
    }

    static {
        ResumablePromise.defineClass<ResumableAllSettledPromise<any>>({
            type: 'all_settled',
            resumer: (data, { require }) => {
                const entries = data.entries.map((e) => require(e));
                return new this(entries);
            },
        })
    }

    protected followPromises() {
        const entries = this.entries;
        trackPromiseList(entries, (settled) => {
            if (allSettled(entries)) {
                this.resolve_from_entries();
            } else {
                this.compute_paused();
            }
        });
    }

    protected resolve_from_entries() {
        this.resolve(this.entries.map(p => {
            const fp = p as ResumablePromise<any>;
            if (fp.promise_state == 'accepted') return { status: "fulfilled", value: fp.promise_value };
            if (fp.promise_state == 'rejected') return { status: "rejected", reason: fp.promise_value };
        }) as any);
    }

    protected awaiting_for() {
        return this.entries;
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('all_settled');
        ctx.side_effects(false);
        return {
            entries: this.entries.map(e => ctx.ref(e)),
        }
    }
}

export class FailedResume extends ResumablePromise<any> {
    constructor(
        readonly error: Error,
        protected readonly serialized: FullySerializedResumable,
        protected readonly loaded_dependencies: ResumablePromise[],
    ) {
        super();

        // Track promises, swapping them for SettledPromise when they settle
        trackPromiseList(loaded_dependencies, null, {
            always_swap: true,
        });
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type(this.serialized.type);
        ctx.side_effects(!this.serialized.sideeffect_free);
        for (let p of this.loaded_dependencies) {
            ctx.ref(p);
        }
        return this.serialized.data;
    }
}

interface SerializedSettledPromise {
    value: any;
    result: 'accept' | 'reject_raw' | 'reject_error';
}

export class SettledPromise<T> extends ResumablePromise<T> {
    constructor(readonly state: SerializedSettledPromise) {
        super();
        // Silence unhandled reject errors
        this.then(() => { }, () => { }, true);
        this.settle();
    }

    static {
        ResumablePromise.defineClass<SettledPromise<any>>({
            type: 'settled',
            resumer: (data, { require }) => {
                return new this(data.state);
            },
        })
    }

    static can_suspend(resumable: ResumablePromise) {
        if (resumable.promise_state == "rejected" && resumable.promise_value instanceof Error) {
            return true
        } else {
            return serializable(resumable.promise_value, []);
        }
    }

    static for_resumable(resumable: ResumablePromise) {
        if (!resumable.settled) return resumable;
        if (resumable.promise_state == "accepted") {
            return new SettledPromise({ result: "accept", value: resumable.promise_value });
        } else if (resumable.promise_value instanceof Error) {
            return new SettledPromise({ result: "reject_error", value: resumable.promise_value.message });
        } else {
            return new SettledPromise({ result: "reject_raw", value: resumable.promise_value });
        }
    }

    protected settle() {
        const state = this.state;
        if (state.result == "accept") {
            this.resolve(state.value);
        } else if (state.result == "reject_error") {
            this.reject(new Error(state.value));
        } else {
            this.reject(state.value);
        }
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        return SettledPromise.can_suspend(this);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('settled');
        ctx.side_effects(false);
        return {
            state: this.state,
        }
    }
}

function allSettled(promises: PromiseLike<any>[]) {
    for (let p of promises) {
        if (p instanceof ResumablePromise) {
            if (!p.settled) return false;
        } else {
            return false;
        }
    }
    return true;
}

function trackPromiseList(
    promises: PromiseLike<any>[],
    onSettle?: (settled: ResumablePromise<any>, listIndex: number) => void,
    { always_swap = false }: { always_swap?: boolean } = {},
) {
    promises.forEach((dep, idx) => {
        if (dep instanceof SettledPromise) return;

        // We can save some cycles if we only convert native promises to SettledPromise (and only let serialize_all convert if needed)
        const shouldConvert = always_swap || !(dep instanceof ResumablePromise);

        const then_args: any[] = [
            (result) => {
                if (shouldConvert) {
                    promises[idx] = new SettledPromise({ result: "accept", value: result });
                }
                onSettle?.(promises[idx] as any, idx);
            },
            (err) => {
                if (shouldConvert) {
                    if (err instanceof Error) {
                        promises[idx] = new SettledPromise({ result: "reject_error", value: err.message });
                    } else {
                        promises[idx] = new SettledPromise({ result: "reject_raw", value: err });
                    }
                }
                onSettle?.(promises[idx] as any, idx);
            },
        ]

        if (dep instanceof ResumablePromise) then_args.push(true);

        dep.then(...then_args);
    })
}
