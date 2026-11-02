
import { InvertedWeakMap } from "@matchlighter/common_library/data/inverted_weakmap";

import { AsyncLocalStorage } from "async_hooks";
import { Executor } from "../regen_executor";
import { decodeGraph, encodeGraph, findUnencodable, type EncodedGraph } from "../../common/graph_json";
import { CancellableResumablePromise, ResumablePromise, SerializeContext, type ResumableDescription } from "./resumable_promise";

const RESUMABLE_CONTEXT_ID = Symbol("resumable_serialized_id");
export const EXECUTOR_FACTORY = Symbol("builder");

interface SerializedScope {
    owner: string;
    method: string;
    /** Legacy (pre-`frame`) only */
    parameters?: any[];
}

/**
 * Everything the method's code can reach: persisted as a single graph (`encodeGraph`) so that references shared between
 * them (eg. a local and a temporary holding the same array) or cycles survive a suspend as one object, not copies.
 */
interface ExecutionFrame {
    parameters: any[];
    state: any;
    temporaries: Record<string, any>;
    completions: { type: string, arg?: any }[];
    arg: any;
    sent: any;
    rval: any;
}

/** The persisted frame of a `@resumable`, including from data written before frames were a single graph */
export function decodeResumableFrame(data: any): ExecutionFrame {
    if (data.frame) return decodeGraph(data.frame as EncodedGraph);
    // Legacy: each part was serialized independently (plain JSON)
    return {
        parameters: data.scope.parameters,
        state: data.state,
        temporaries: data.temporaries,
        completions: data.completions,
        arg: data.arg,
        sent: data.sent,
        rval: data.rval,
    };
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
        const frame = decodeResumableFrame(data);
        const dep = require(data.pending_promise);

        const owner = resumable.lookup_owner(scope.owner);
        const executor: Executor<any> = owner[scope.method][EXECUTOR_FACTORY].call(owner, ...frame.parameters);

        // TODO How to handle unregistered owner?

        const newIndexedMarks = executor.options?.marked_locs;
        const oldIndexedMarks = data.marked_locations;

        // Validate that at least counts are the same. We won't be able to perfectly guarantee that there weren't major control/flow changes,
        //   but checking count should be able to catch most issues and issue a warning
        if (oldIndexedMarks && oldIndexedMarks.length != newIndexedMarks.length) {
            throw new MethodResumeError(`Reloading @resumable "${scope.owner}:${scope.method}"; Control flow was obviously changed! You should version your @resumables when making such changes.`)
        }

        Object.assign(executor, {
            ...frame.temporaries,
            state: frame.state,
            ...(frame.completions && { completions: frame.completions }),
            arg: frame.arg,
            sent: frame.sent,
            actionType: data.actionType,
            // Using mark index makes things more stable if the expressions of the resumable change, but flow changes will still be problematic
            prev: newIndexedMarks[data.prevIndex] || data.prev,
            next: newIndexedMarks[data.nextIndex] || data.next,
            done: data.done,
            rval: frame.rval,
        });

        const rthmd = new ResumableMethod(executor);
        rthmd['scope'] = {
            owner,
            method: scope.method,
            parameters: frame.parameters,
        }
        rthmd.startedAt = data.started_at ?? rthmd.startedAt;
        rthmd.restarts = (data.restarts ?? 0) + 1;
        if (data.script) rthmd.markAsScript();

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
            // What this waits on changed
            this._store.emit('change');
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

    /** epoch ms the call started (the original start, for one resumed after a restart) */
    startedAt = this.createdAt;
    /** App restarts survived */
    restarts = 0;
    private is_script = false;

    /** This is a run of a `@script({ shutdown: 'suspend' })` rather than a plain `@resumable` call */
    markAsScript() { this.is_script = true }

    describe(): ResumableDescription {
        return {
            type: this.is_script ? 'script' : 'resumable',
            owner: String(this.scope.owner?.[RESUMABLE_CONTEXT_ID] ?? 'unknown'),
            method: this.scope.method,
            params: this.scope.parameters,
            startedAt: this.startedAt,
            restarts: this.restarts,
            wait: this.describeWait(),
        };
    }

    protected awaiting_for() {
        const exc = this.executor;

        if (exc.pending_promise) {
            return [exc.pending_promise];
        }
        return [];
    }

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
            } as SerializedScope,
            started: exc._started,
            started_at: this.startedAt,
            restarts: this.restarts,
            script: this.is_script,

            frame: encodeGraph(this.frame()),
            actionType: exc.actionType,

            marked_locations: exc.options.marked_locs,
            prev: exc.prev,
            prevIndex: exc.options.marked_locs.indexOf(exc.prev),
            next: exc.next,
            nextIndex: exc.options.marked_locs.indexOf(exc.next as any),

            done: exc.done,
        }
    }

    private frame(): ExecutionFrame {
        const exc = this.executor;
        return {
            parameters: this.scope.parameters,
            state: exc.state,
            temporaries: exc.temporaries,
            completions: exc.completions,
            arg: exc.arg,
            sent: exc.sent,
            rval: exc.rval,
        };
    }

    /** The first part of the frame (eg. `state.fn`) that can't be persisted, as a message */
    private unpersistable() {
        const bad = findUnencodable(this.frame());
        return bad && `${bad.path} is ${bad.what}, which can't be persisted`;
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        return !this.unpersistable();
    }

    protected cannot_suspend_reason() {
        return this.unpersistable() ?? super.cannot_suspend_reason();
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

        // Never started (eg. queued): there is no step to deliver an error to, so let the Executor settle us directly.
        if (!exc._started) {
            exc.cancel(reason);
            return;
        }

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
 * NB: All variables must be JSON serializable (Errors are kept as their name, message and stack). One that holds anything else
 * (eg. a function) at shutdown is given up on: it is not persisted, and the shutdown reports why (see `ResumableStore.save`).
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
