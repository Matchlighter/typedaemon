
import { ExtensiblePromise } from "@matchlighter/common_library/cjs/promises"
import { pojso } from "./util";

export class Suspend extends Error {

}

export interface SerializedResumable {
    type: 'all' | string;
    depends_on?: ResumablePromise<any>[];
    sideeffect_free?: boolean;
    [key: string]: any;
}

interface FullySerializedResumable {
    id: string;
    type: 'all' | string;
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

export abstract class ResumablePromise<T = any> extends ExtensiblePromise<T> {
    static all<const T extends readonly Promise<any>[]>(promises: T) {
        return new ResumableAllPromise(promises);
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

    can_suspend() {
        return true;
    }

    private has_non_resumable_awaiters = true;
    private resumable_awaiters: ResumablePromise<any>[] = [];

    // All awaiters must be ResumablePromises and themselves be ready to suspend
    tree_can_suspend() {
        if (!this.has_non_resumable_awaiters) return false;
        if (!this.can_suspend()) return false;

        for (let res of this.resumable_awaiters) {
            if (!res.can_suspend()) return false;
        }

        return true;
    }

    protected _suspended;
    suspend() {
        if (this._suspended) return;
        this._reject(new Suspend());
    }
    get suspended() { return this._suspended; }

    abstract serialize(): SerializedResumable;
}

class ResumableAllPromise<const T extends readonly PromiseLike<any>[]> extends ResumablePromise<T> {
    constructor(readonly promises: T) {
        super();

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

    private resolved_values = [];
    private pending_promises = new Set<PromiseLike<any>>();

    can_suspend() {
        if (!pojso(this.resolved_values)) return false;

        for (let pending of this.pending_promises) {
            if (!(pending instanceof ResumablePromise)) return false;
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

ResumablePromise.defineClass({
    type: 'all',
    resumer: (data, { require }) => {
        return new ResumableAllPromise(
            data.depends_on.map(dp => require(dp)),
        );
    },
})
