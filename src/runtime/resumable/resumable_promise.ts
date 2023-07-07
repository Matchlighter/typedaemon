
import { ExtensiblePromise } from "@matchlighter/common_library/promises"
import { deep_pojso } from "../../common/util";
import { current } from "../../hypervisor/current";
import { ResumableStore } from ".";

export class Suspend extends Error {
    constructor(...args) {
        super(...args)
        this.suspended = new Promise(accept => {
            this.ack = accept as any;
        })
    }

    readonly suspended: Promise<never>;
    ack: () => void;
}

export interface SerializedResumable {
    type: string;
    sideeffect_free?: boolean;
    [key: string]: any;
}

export interface FullySerializedResumable {
    id: string;
    type: string;
    depends_on?: string[];
    data: any;
    sideeffect_free?: boolean;
}

type PromiseReference = number;

interface ResumerContext {
    require: (key: PromiseReference) => ResumablePromise;
    metadata?: FullySerializedResumable;
}
export interface SerializeContext {
    ref: (rp: ResumablePromise) => PromiseReference;
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

export interface FailedResume {
    // data: FullySerializedResumable;
    error: Error;
    depends_on: (ResumablePromise | FailedResume)[];
    load_data: FullySerializedResumable;
}

type LoadedResumable = ResumablePromise | FailedResume;

export abstract class ResumablePromise<T = any> extends ExtensiblePromise<T> {
    static Suspended = Suspend;

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
        const loaded_promises: Record<string, LoadedResumable> = {};
        const failed_promises: FailedResume[] = []

        const load = (key: string) => {
            let loaded = loaded_promises[key];

            if (!loaded) {
                const pdata = by_id[key] as FullySerializedResumable;
                if (!pdata) throw new Error(`No ResumablePromise with key ${key} in file`);
                const classif = this.classifications[pdata.type];

                const cdata = pdata.data;

                try {
                    loaded = classif.resumer(cdata, {
                        require: (dep_index) => load(pdata.depends_on[dep_index]),
                        metadata: pdata,
                    });
                } catch (ex) {
                    loaded = {
                        load_data: pdata,
                        error: ex,
                        depends_on: [],
                    } satisfies FailedResume
                    failed_promises.push(loaded);
                }

                loaded_promises[key] = loaded;
            }

            if (loaded) {
                if (loaded instanceof ResumablePromise) return loaded;
                throw loaded.error;
            }

            return null;
        }

        for (let v of data) by_id[v.id] = v;
        for (let [k, v] of Object.entries(by_id)) {
            try {
                load(k);
            } catch (ex) { }
        }

        // Map Failed-to-Load Resumables and have them track dependencies that were able to load.
        for (let f of failed_promises) {
            f.depends_on = (f.load_data.depends_on || []).map((dk, i) => {
                const dep = loaded_promises[dk];
                if (dep instanceof ResumablePromise) {
                    dep.then(
                        (result) => {
                            f.depends_on[i] = new ResolvedPromise(result);
                        },
                        (err) => {
                            f.depends_on[i] = new RejectedPromise(err);
                        },
                        true
                    )
                }
                return dep || dk as any;
            });
        }

        return {
            loaded: loaded_promises,
            failures: failed_promises,
        }
    }

    static serialize_all(promises: LoadedResumable[] | Generator<LoadedResumable>) {
        // Discovery Phase
        const promise_to_serialized = new Map<LoadedResumable, FullySerializedResumable>();

        function discover(obj: LoadedResumable) {
            if (!obj) return;
            if (promise_to_serialized.has(obj)) return;

            const id = String(cuid++);

            const srepr: FullySerializedResumable = {
                id,
                type: null,
                depends_on: [],
                data: {},
            };
            promise_to_serialized.set(obj, srepr as any);

            const context: SerializeContext = {
                ref: (rp) => {
                    discover(rp);
                    const dep_entry = promise_to_serialized.get(rp);
                    srepr.depends_on.push(dep_entry.id);
                    return srepr.depends_on.length - 1;
                },
            }

            if (obj instanceof ResumablePromise) {
                const sdata = obj.serialize(context);
                srepr.type = sdata.type;
                Object.assign(srepr, sdata)

                for (let aw of obj.awaited_by()) {
                    discover(aw);
                }
            } else {
                const sdata = obj.load_data;
                srepr.type = sdata.type;
                srepr.data = sdata;

                sdata.depends_on = obj.depends_on.map(ldep => {
                    discover(ldep);
                    const dep_entry = promise_to_serialized.get(ldep);
                    return dep_entry.id;
                });
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
            for (let depid of info.depends_on) {
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

    // All awaiters must be ResumablePromises and themselves be ready to suspend
    /** @deprecated */
    treeCanSuspend(resultCache?: Map<ResumablePromise, boolean>) {
        const handledLinks = new Set<PromiseLike<any>>();
        const pending_links: PromiseLike<any>[] = [this]
        const ctx: CanSuspendContext = {
            link(prom) {
                if (!prom || handledLinks.has(prom)) return;
                handledLinks.add(prom);
                pending_links.push(prom);
            }
        }

        while (pending_links.length > 0) {
            const link = pending_links.shift();
            if (link instanceof ResumablePromise) {
                if (resultCache && resultCache.has(link)) {
                    if (!resultCache.get(link)) return false;
                } else {
                    const can = link.can_suspend();
                    if (resultCache) resultCache.set(link, can);
                    if (!can) return false;
                }
            } else {
                return false;
            }
        }

        return true;
    }

    protected search_tree(predicate: (p: PromiseLike<any>) => boolean) {
        const handledLinks = new Set<PromiseLike<any>>();
        const pending_links: PromiseLike<any>[] = [this]
        const ctx: CanSuspendContext = {
            link(prom) {
                if (!prom || handledLinks.has(prom)) return;
                handledLinks.add(prom);
                pending_links.push(prom);
            }
        }

        while (pending_links.length > 0) {
            const link = pending_links.shift();
            if (predicate(link)) return link;

            if (link instanceof ResumablePromise) {
                for (let p of link.awaited_by()) {
                    ctx.link(p);
                }
                for (let p of link.awaiting_for()) {
                    ctx.link(p);
                }
            }
        }

        return null;
    }

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

    force_suspend() {
        this._suspended = true;
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

        if (desired_pause != this.suspended) {
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
        }
    }

    // protected _suspended;
    // async suspend() {
    //     if (this._suspended) return;
    //     this._suspended = true;

    //     const spend = new Suspend();
    //     this._reject(spend);
    //     await spend.suspended;
    // }
    // get suspended() { return this._suspended; }

    abstract serialize(ctx: SerializeContext): SerializedResumable;
}

interface MultiPromiseState {
    type: "promise" | "accepted" | "rejected";
    value: any;
}

export class ResumableAllPromise<const T extends readonly PromiseLike<any>[]> extends ResumablePromise<T> {
    constructor(protected entries: MultiPromiseState[]) {
        super();
        this.followPromises();
    }

    static create(promises: any[]) {
        return new this(promises.map(p => ({ type: p.then ? "promise" : "accepted", value: p })))
    }

    static {
        ResumablePromise.defineClass<ResumableAllPromise<any>>({
            type: 'all',
            resumer: (data, { require }) => {
                const entries = data.entries.map((e) => {
                    if (e.type == "promise") e.value = require(e.value);
                    return e;
                })
                return new this(entries);
            },
        })
    }

    private pending_promises = new Set<PromiseLike<any>>();

    protected followPromises() {
        const entries = this.entries;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            if (entry.type == 'promise') {
                const prom = entry.value as Promise<any>;
                this.pending_promises.add(prom);

                const thenArgs: any[] = [
                    (result) => {
                        this.entries[i] = { type: "accepted", value: result }
                        this.pending_promises.delete(prom);

                        if (this.pending_promises.size == 0) {
                            this.resolve_from_entries();
                        } else {
                            this.compute_paused();
                        }
                    },
                    (err) => {
                        this._reject(err);
                    },
                ]
                if (prom instanceof ResumablePromise) {
                    thenArgs.push(this);
                }
                prom.then(...thenArgs);
            }
        }
    }

    protected resolve_from_entries() {
        this._resolve(this.entries.map(e => e.value) as any);
    }

    protected awaiting_for() {
        return this.pending_promises;
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        for (let e of this.entries) {
            if (e.type != "promise" && !deep_pojso(e.value)) return false;
        }
        return true;
    }

    force_suspend(): void {
        // TODO _reject with a Suspended error
        // this._reject(new Susp)
    }

    serialize(ctx: SerializeContext) {
        return {
            type: 'all',
            entries: this.entries.map(e => {
                e = { ...e };
                if (e.type == "promise") e.value = ctx.ref(e.value);
                return e;
            }),
            sideeffect_free: true,
        }
    }
}

type PromiseList = readonly PromiseLike<any>[]
type MappedPromiseSettledReult<T extends PromiseList> = { [K in keyof T]: PromiseSettledResult<T[K]> };

export class ResumableAllSettledPromise<const T extends PromiseList> extends ResumablePromise<MappedPromiseSettledReult<T>> {
    constructor(protected entries: MultiPromiseState[]) {
        super();
        this.followPromises();
    }

    static create(promises: any[]) {
        return new this(promises.map(p => ({ type: p.then ? "promise" : "accepted", value: p })))
    }

    static {
        ResumablePromise.defineClass<ResumableAllSettledPromise<any>>({
            type: 'all_settled',
            resumer: (data, { require }) => {
                const entries = data.entries.map((e) => {
                    if (e.type == "promise") e.value = require(e.value);
                    return e;
                })
                return new this(entries);
            },
        })
    }

    private pending_promises = new Set<PromiseLike<any>>();

    protected followPromises() {
        const entries = this.entries;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            if (entry.type == 'promise') {
                const prom = entry.value as Promise<any>;
                this.pending_promises.add(prom);

                const oneSettled = (descriptor: MultiPromiseState) => {
                    this.entries[i] = descriptor;
                    this.pending_promises.delete(prom);
                    if (this.pending_promises.size == 0) {
                        this.resolve_from_entries();
                    } else {
                        this.compute_paused();
                    }
                }

                const thenArgs: any[] = [
                    (value) => oneSettled({ type: "accepted", value }),
                    (reason) => oneSettled({ type: "rejected", value: reason }),
                ]

                if (prom instanceof ResumablePromise) {
                    thenArgs.push(this);
                }

                prom.then(...thenArgs);
            }
        }
    }

    protected resolve_from_entries() {
        this._resolve(this.entries.map((e): PromiseSettledResult<any>  => {
            if (e.type == "accepted") return { status: "fulfilled", value: e.value }
            if (e.type == "rejected") return { status: "rejected", reason: e.value }
        }) as any);
    }

    protected awaiting_for() {
        return this.pending_promises;
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        for (let e of this.entries) {
            if (e.type != "promise" && !deep_pojso(e.value)) return false;
        }
        return true;
    }

    force_suspend(): void {
        super.force_suspend();
        for (let e of this.entries) {
            if (e.type == "promise" && !(e.value instanceof ResumablePromise)) {
                e.type = "rejected";
                e.value = "Didn't Suspend" // TODO Make a Serializable Error
            }
        }
    }

    serialize(ctx: SerializeContext) {
        return {
            type: 'all_settled',
            entries: this.entries.map(e => {
                e = { ...e };
                if (e.type == "promise") e.value = ctx.ref(e.value);
                return e;
            }),
            sideeffect_free: true,
        }
    }
}

export class ResolvedPromise<T> extends ResumablePromise<T> {
    constructor(readonly result: T) {
        super();
        this._resolve(result);
    }

    static {
        ResumablePromise.defineClass<ResolvedPromise<any>>({
            type: 'resolved',
            resumer: (data, { require }) => {
                return new this(data.value);
            },
        })
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        if (!deep_pojso(this.result)) return false;
        return true;
    }

    serialize() {
        return {
            type: 'resolved',
            value: this.result,
            sideeffect_free: true,
        }
    }
}

export class RejectedPromise<T> extends ResumablePromise<T> {
    constructor(readonly result: T) {
        super();
        this._reject(result);
    }

    static {
        ResumablePromise.defineClass<RejectedPromise<any>>({
            type: 'rejected',
            resumer: (data, { require }) => {
                return new this(data.value);
            },
        })
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        if (!deep_pojso(this.result)) return false;
        return true;
    }

    serialize() {
        return {
            type: 'rejected',
            value: this.result,
            sideeffect_free: true,
        }
    }
}
