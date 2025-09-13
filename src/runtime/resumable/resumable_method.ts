
import { InvertedWeakMap } from "@matchlighter/common_library/data/inverted_weakmap";

import { AsyncLocalStorage } from "async_hooks";
import { Executor } from "../regen_executor";
import { deep_pojso } from "../../common/util";
import { CancellableResumablePromise, ResumablePromise, SerializeContext } from "./resumable_promise";

const RESUMABLE_CONTEXT_ID = Symbol("resumable_serialized_id");
export const EXECUTOR_FACTORY = Symbol("builder");

interface SerializedScope {
    owner: string;
    method: string;
    parameters: any[];
}

interface HotScope {
    owner: any;
    method: string;
    parameters: any[];
}

export type ResumableOwnerLookup = object | ((key: string) => any);
const ContextResumableOwnerLookup = new AsyncLocalStorage<ResumableOwnerLookup>()
const RESUMABLE_OWNERS = new InvertedWeakMap<string, any>()
const defaultResumableOwnerLookup: ResumableOwnerLookup = (key) => RESUMABLE_OWNERS.get(key);

export class MethodResumeError extends Error { }

ResumablePromise.defineClass<ResumableMethod<any>>({
    type: "@resumable",
    resumer: (data, { require }) => {
        const scope = data.scope;
        const dep = require(data.pending_promise);

        const owner = resumable.lookup_owner(scope.owner);
        const executor: Executor<any> = owner[scope.method][EXECUTOR_FACTORY].call(owner, ...scope.parameters);

        // TODO How to handle unregistered owner?

        const newIndexedMarks = executor.options?.marked_locs;
        const oldIndexedMarks = data.marked_locations;

        // Validate that at least counts are the same. We won't be able to perfectly guarantee that there weren't major control/flow changes,
        //   but checking count should be able to catch most issues and issue a warning
        if (oldIndexedMarks && oldIndexedMarks.length != newIndexedMarks.length) {
            throw new MethodResumeError(`Reloading @resumable "${scope.owner}:${scope.method}"; Control flow was obviously changed! You should version your @resumables when making such changes.`)
        }

        Object.assign(executor, {
            state: data.state,
            arg: data.arg,
            sent: data.sent,
            actionType: data.actionType,
            // Using mark index makes things more stable if the expressions of the resumable change, but flow changes will still be problematic
            prev: newIndexedMarks[data.prevIndex] || data.prev,
            next: newIndexedMarks[data.next] || data.next,
            done: data.done,
            rval: data.rval,
        });

        const rthmd = new ResumableMethod(executor);
        rthmd['scope'] = {
            ...scope,
            owner,
        }

        if (data.started ?? true) {
            rthmd.resume(dep);
        }

        return rthmd;
    },
})

export class ResumableMethod<T> extends CancellableResumablePromise<T> {
    constructor(readonly executor: Executor<T>) {
        super();

        executor.owner = this;

        executor.pre_step_hook = () => {
            this.compute_paused();
            return !this.suspended;
        }

        executor.await_promise_hook = (promise, then_args) => {
            // TODO It may be worth determining if this hook can be replaced with AsyncLocalStorage
            if (promise instanceof ResumablePromise) {
                then_args.push(this);
            }
            return promise.then(...then_args);
        }

        executor.on_completed = (success, value) => {
            if (success) {
                this.resolve(value);
            } else {
                this.reject(value);
            }
        }
    }

    scope: HotScope;

    resume(waitFor?: ResumablePromise<any>) {
        const exc = this.executor;

        if (exc._started) throw new Error("Already Started!");
        exc._started = true;

        if (waitFor) {
            exc.invoke_promise(waitFor);
        } else {
            exc.invoke(exc.actionType, exc.arg);
        }
    }

    serialize(context: SerializeContext) {
        const exc = this.executor;

        context.set_type("@resumable");
        context.side_effects(true);
        return {
            pending_promise: context.ref(exc.pending_promise),
            scope: {
                owner: this.scope.owner[RESUMABLE_CONTEXT_ID],
                method: this.scope.method,
                parameters: this.scope.parameters,
            } as SerializedScope,
            started: exc._started,

            state: exc.state,
            arg: exc.arg,
            sent: exc.sent,
            actionType: exc.actionType,

            marked_locations: exc.options.marked_locs,
            prev: exc.prev,
            prevIndex: exc.options.marked_locs.indexOf(exc.prev),
            next: exc.next,
            nextIndex: exc.options.marked_locs.indexOf(exc.next as any),

            done: exc.done,
            rval: exc.rval,
        }
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        if (deep_pojso(this.executor.state)) return false;
        // TODO: Also check if arg is serializable
        return true;
    }

    protected awaiting_for() {
        const exc = this.executor;

        if (exc.pending_promise) {
            return [exc.pending_promise];
        }
        return [];
    }

    protected do_unsuspend(): void {
        const exc = this.executor;
        if (!exc.pending_promise) {
            exc.invoke(exc.actionType, exc.arg);
        }
    }

    isCancellable(): boolean {
        // TODO "atomic" option that disallows cancellation of this method
        // Or an `allow_cancellation(false/true)` meta function?
        return true;
    }

    cancel(reason?: any): void {
        // TODO If not currently cancellable, store the cancellation for when/if it becomes cancellable
        return super.cancel(reason);
    }

    protected _cancel(reason?: any) {
        const exc = this.executor;

        // Inject the error when control returns to this Executor.
        // Injecting into both this Executor and child (done by ResumablePromise) makes sure that we cancel this (the parent) Executor,
        //   even if the child Cancellable swallows the error.
        exc.injectError(reason);
    }

    force_suspend(): void {
        const exc = this.executor;

        super.force_suspend();
        exc.pending_promise = null;

        exc.actionType = "throw";
        // TODO Serialize and Deserialize the actual error.
        exc.arg = { error: "Failed to Suspend!" };
    }
}

/**
 * Mark a method as resumable. When the app or TypeDaemon shutdown, the current execution
 * state will be saved and reloaded when the app starts again.
 * 
 * NB: All variables must be JSON serializable.
 */
export const resumable = (f, context: ClassMethodDecoratorContext) => {
    function start_wrapped(...args) {
        const executor: Executor<any> = f.call(this, ...args);
        const rmthd = new ResumableMethod(executor);
        rmthd.scope = {
            owner: this,
            method: context.name as string,
            parameters: args,
        }

        rmthd.resume();

        return rmthd;
    }

    start_wrapped[EXECUTOR_FACTORY] = f;

    return start_wrapped as any;
}

resumable.with_lookup_context = <F extends () => any>(lookup: ResumableOwnerLookup, f: F): ReturnType<F> => {
    return ContextResumableOwnerLookup.run(lookup, f);
}

resumable.register_context = (id: string, thing: any, local = false) => {
    thing[RESUMABLE_CONTEXT_ID] = id;
    if (!local) {
        RESUMABLE_OWNERS.set(id, thing);
    }
}

resumable.lookup_owner = (key: string) => {
    const lookupOwner = ContextResumableOwnerLookup.getStore() || defaultResumableOwnerLookup;
    if (typeof lookupOwner == 'object') return lookupOwner[key];
    if (typeof lookupOwner == 'function') return lookupOwner(key);
}

/**
 * ResumablePromise subclass that awaits another ResumablePromise and then calls a method on the Application
 * 
 * Mainly an internal helper to help with functions like `run_at().persisted()`
 */
export class ResumableCallbackPromise extends ResumablePromise<any> {
    constructor(readonly await_for: ResumablePromise<any>, readonly method_name: string, readonly lookup_context = "APPLICATION") {
        super();

        await_for.then(() => {
            resumable.lookup_owner(lookup_context)[method_name]();
        }, () => { }, this);
    }

    static {
        ResumablePromise.defineClass<ResumableCallbackPromise>({
            type: 'call_by_name',
            resumer: (data, { require }) => {
                return new this(require(data.await_for), data.method, data.lookup_context);
            },
        })
    }

    protected awaiting_for(): Iterable<PromiseLike<any>> {
        return [this.await_for]
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('call_by_name');
        return {
            method: this.method_name,
            lookup_context: this.lookup_context,
            await_for: ctx.ref(this.await_for),
        }
    }
}
