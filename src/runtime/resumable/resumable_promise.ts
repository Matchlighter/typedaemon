
import { ExtensiblePromise } from "@matchlighter/common_library/promises"
import { deep_pojso } from "../../common/util";
import { current } from "../../hypervisor/current";

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
    depends_on?: ResumablePromise<any>[];
    sideeffect_free?: boolean;
    [key: string]: any;
}

export interface FullySerializedResumable {
    id: string;
    type: string;
    depends_on?: string[];
    scope?: {
        owner: string;
        method: string;
        parameters: [];
    };
    [key: string]: any;
}

interface ResumerContext {
    require: (key: string) => ResumablePromise;
}

interface Resumer<T extends ResumablePromise> {
    (data: FullySerializedResumable, context: ResumerContext): T;
}

interface ResumablePromiseClass {
    type: string;
    resumer: Resumer<any>;
    // /** pure resumables are just waiters - there are no side-effects, so if nothing depends on one, it can just be dropped */
    // pure?: boolean;
}

export interface CanSuspendContext {
    link: (prom: PromiseLike<any>) => void
}

export abstract class ResumablePromise<T = any> extends ExtensiblePromise<T> {
    static Suspended = Suspend;

    static all<const T extends readonly Promise<any>[]>(promises: T) {
        return new ResumableAllPromise(promises);
    }

    static allSettled<const T extends readonly Promise<any>[]>(promises: T) {
        return new ResumableAllSettledPromise(promises);
    }

    private static classifications: Record<string, ResumablePromiseClass> = {};
    static defineClass(cfg: ResumablePromiseClass) {
        this.classifications[cfg.type] = cfg;
    }

    static resumePromises(data: FullySerializedResumable[]) {
        const loaded_promises: Record<string, ResumablePromise> = {};
        const by_id: Record<number, FullySerializedResumable> = {};

        const load = (key: string) => {
            let loaded = loaded_promises[key];
            if (loaded) return loaded;

            const pdata = by_id[key] as FullySerializedResumable;
            const classif = this.classifications[pdata.type];

            loaded = classif.resumer(pdata, context);

            loaded_promises[key] = loaded;
            return loaded;
        }

        const context: ResumerContext = {
            require: load,
        }

        for (let v of data) by_id[v.id] = v;
        for (let [k, v] of Object.entries(by_id)) {
            load(k);
        }
    }

    static serialize_all(promises: ResumablePromise[] | Generator<ResumablePromise>) {
        const serialized_by_id: Record<number, FullySerializedResumable> = {};
        const promise_to_serialized = new Map<ResumablePromise, SerializedResumable>();

        function commit_item(info: SerializedResumable) {
            if (serialized_by_id[info.id]) return;

            const ser_info: FullySerializedResumable = {
                ...info as any,
                depends_on: info.depends_on?.map(dep => {
                    const dep_entry = promise_to_serialized.get(dep);
                    commit_item(dep_entry);
                    return dep_entry.id;
                })
            };

            serialized_by_id[ser_info.id] = ser_info;
        }

        function discover(rp: ResumablePromise) {
            if (promise_to_serialized.has(rp)) return;

            const id = cuid++;
            const partial = rp.serialize();
            partial.id = id;
            promise_to_serialized.set(rp, partial);

            for (let aw of rp.resumable_awaiters) {
                discover(aw);
            }

            for (let drp of partial.depends_on || []) {
                discover(drp);
            }
        }

        let cuid = 0;
        for (let rp of promises) {
            discover(rp);
        }

        for (let [promise, serialized] of promise_to_serialized.entries()) {
            if (!serialized.sideeffect_free) {
                commit_item(serialized);
            }
        }

        return [...Object.values(serialized_by_id)];
    }

    constructor() {
        super();
        current.application.resumableStore.track(this);
    }

    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>,
        onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>,
        resumable: ResumablePromise<any> | boolean = false,
    ): Promise<TResult1 | TResult2> {
        if (!resumable) {
            this.has_non_resumable_awaiters = false;
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
        return this.then(handle, handle, resumable);
    }

    protected can_suspend({ link }: CanSuspendContext) {
        if (!this.has_non_resumable_awaiters) return false;

        for (let res of this.resumable_awaiters) {
            link(res);
        }

        return true;
    }

    private has_non_resumable_awaiters = true;
    private resumable_awaiters: ResumablePromise<any>[] = [];

    // All awaiters must be ResumablePromises and themselves be ready to suspend
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
                    const can = link.can_suspend(ctx);
                    if (resultCache) resultCache.set(link, can);
                    if (!can) return false;
                }
            } else {
                return false;
            }
        }

        return true;
    }

    protected _suspended;
    async suspend() {
        if (this._suspended) return;
        this._suspended = true;

        const spend = new Suspend();
        this._reject(spend);
        await spend.suspended;
    }
    get suspended() { return this._suspended; }

    abstract serialize(): SerializedResumable;
}

export class ResumableAllPromise<const T extends readonly PromiseLike<any>[]> extends ResumablePromise<T> {
    constructor(readonly promises: T) {
        super();
        this.followPromises(promises);
    }

    static {
        ResumablePromise.defineClass({
            type: 'all',
            resumer: (data, { require }) => {
                return new this(
                    data.depends_on.map(dp => require(dp)),
                );
            },
        })
    }

    private resolved_values = [];
    private pending_promises = new Set<PromiseLike<any>>();

    protected followPromises(promises: T) {
        for (let i = 0; i < promises.length; i++) {
            const prom = promises[i];
            this.pending_promises.add(prom);

            const thenArgs: any[] = [
                (result) => {
                    this.resolved_values[i] = result;
                    this.pending_promises.delete(prom);
                    if (this.pending_promises.size == 0) {
                        this._resolve(this.resolved_values as any);
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

    protected can_suspend(ctx: CanSuspendContext) {
        if (!super.can_suspend(ctx)) return false;
        if (!deep_pojso(this.resolved_values)) return false;
        for (let pending of this.pending_promises) {
            ctx.link(pending);
        }
        return true;
    }

    serialize(): SerializedResumable {
        return {
            type: 'all',
            depends_on: this.promises as any,
            sideeffect_free: true,
        }
    }
}

type PromiseList = readonly PromiseLike<any>[]
type MappedPromiseSettledReult<T extends PromiseList> = { [K in keyof T]: PromiseSettledResult<T[K]> };

export class ResumableAllSettledPromise<const T extends PromiseList> extends ResumablePromise<MappedPromiseSettledReult<T>> {
    constructor(readonly promises: T) {
        super();

        for (let i = 0; i < promises.length; i++) {
            const prom = promises[i];
            this.pending_promises.add(prom);

            const oneSettled = (descriptor: PromiseSettledResult<T>) => {
                this.resolved_values[i] = descriptor;
                this.pending_promises.delete(prom);
                if (this.pending_promises.size == 0) {
                    this._resolve(this.resolved_values as any);
                }
            }
            const thenArgs: any[] = [
                (value) => oneSettled({ status: 'fulfilled', value }),
                (reason) => oneSettled({ status: 'rejected', reason }),
            ]
            if (prom instanceof ResumablePromise) {
                thenArgs.push(this);
            }
            prom.then(...thenArgs);
        }
    }

    static {
        ResumablePromise.defineClass({
            type: 'all_settled',
            resumer: (data, { require }) => {
                return new this(
                    data.depends_on.map(dp => require(dp)),
                );
            },
        })
    }

    private resolved_values: PromiseSettledResult<T>[] = [];
    private pending_promises = new Set<PromiseLike<any>>();

    protected can_suspend(ctx: CanSuspendContext) {
        if (!super.can_suspend(ctx)) return false;
        if (!deep_pojso(this.resolved_values)) return false;
        for (let pending of this.pending_promises) {
            ctx.link(pending);
        }
        return true;
    }

    serialize(): SerializedResumable {
        return {
            type: 'all_settled',
            depends_on: this.promises as any,
            sideeffect_free: true,
        }
    }
}
