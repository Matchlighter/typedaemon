
import { InvertedWeakMap } from "@matchlighter/common_library/data/inverted_weakmap";

import { AsyncLocalStorage } from "async_hooks";
import { deep_pojso } from "../../common/util";
import { ResumablePromise, SerializeContext } from "./resumable_promise";

const Op = Object.prototype;
const hasOwn = Op.hasOwnProperty;

const RESUMABLE_CONTEXT_ID = Symbol("resumable_serialized_id");
const ContinueSentinel = Symbol("continue");
const UNSTARTED_EXEC = Symbol("builder");

type ResumableMethod = 'next' | 'return' | 'throw';

interface HotScope {
    owner: any;
    method: string;
    parameters: any[];
}

interface SerializedScope {
    owner: string;
    method: string;
    parameters: any[];
}

export type ResumableOwnerLookup = object | ((key: string) => any);
const ContextResumableOwnerLookup = new AsyncLocalStorage<ResumableOwnerLookup>()
const RESUMABLE_OWNERS = new InvertedWeakMap<string, any>()
const defaultResumableOwnerLookup: ResumableOwnerLookup = (key) => RESUMABLE_OWNERS.get(key);

export class MethodResumeError extends Error { }

ResumablePromise.defineClass<Executor<any>>({
    type: "@resumable",
    resumer: (data, { require }) => {
        const scope = data.scope;
        const dep = require(data.pending_promise);

        const owner = resumable.lookup_owner(scope.owner);
        const executor: Executor<any> = owner[scope.method][UNSTARTED_EXEC].call(owner, ...scope.parameters);

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

        executor['scope'] = {
            ...scope,
            owner,
        }

        executor.resume(dep);

        return executor;
    },
})

interface ExecutorOptions {
    self: any;
    try_locs: number[][];
    marked_locs: number[];
}

class Executor<T> extends ResumablePromise<T> {
    constructor(generator, readonly options: ExecutorOptions) {
        super();

        this.self = options.self;
        this.generator = generator;

        // The root entry object (effectively a try statement without a catch
        // or a finally block) gives us a place to store values thrown from
        // locations where there is no enclosing try statement.
        const tryLocsList = options.try_locs || [];
        this.tryEntries = [{ tryLoc: "root" }, ...tryLocsList.map(locs => {
            const entry: any = { tryLoc: locs[0] };

            if (1 in locs) {
                entry.catchLoc = locs[1];
            }

            if (2 in locs) {
                entry.finallyLoc = locs[2];
                entry.afterLoc = locs[3];
            }

            return entry;
        })];

        this.reset(true);
    }

    self: any;
    generator;
    private scope: HotScope;

    state: any = {};
    private pending_promise;

    arg;
    sent;
    private actionType: ResumableMethod;
    prev: number;
    next: number | "end";
    done = false;
    private rval: T;

    readonly tryEntries: any[];

    serialize(context: SerializeContext) {
        context.set_type("@resumable");
        context.side_effects(true);
        return {
            pending_promise: context.ref(this.pending_promise),
            scope: {
                owner: this.scope.owner[RESUMABLE_CONTEXT_ID],
                method: this.scope.method,
                parameters: this.scope.parameters,
            } as SerializedScope,
            state: this.state,
            arg: this.arg,
            sent: this.sent,
            actionType: this.actionType,

            marked_locations: this.options.marked_locs,
            prev: this.prev,
            prevIndex: this.options.marked_locs.indexOf(this.prev),
            next: this.next,
            nextIndex: this.options.marked_locs.indexOf(this.next as any),

            done: this.done,
            rval: this.rval,
        }
    }

    protected can_suspend() {
        if (!super.can_suspend()) return false;
        if (deep_pojso(this.state)) return false;
        return true;
    }

    protected awaiting_for() {
        if (this.pending_promise) {
            return [this.pending_promise];
        }
        return [];
    }

    private _started = false;
    start() {
        if (this._started) throw new Error("Already Started!");
        this._started = true;
        this.invoke('next');
    }

    resume(waitFor?: ResumablePromise<any>) {
        if (this._started) throw new Error("Already Started!");
        this._started = true;

        if (waitFor) {
            this.invoke_promise(waitFor);
        } else {
            this.invoke(this.actionType, this.arg);
        }
    }

    protected do_unsuspend(): void {
        if (!this.pending_promise) {
            this.invoke(this.actionType, this.arg);
        }
    }

    force_suspend(): void {
        super.force_suspend();
        this.pending_promise = null;

        this.actionType = "throw";
        // TODO Serialize and Deserialize the actual error.
        this.arg = { error: "Failed to Suspend!" };
    }

    private invoke(method: ResumableMethod, arg?) {
        this.actionType = method;
        this.arg = arg;

        this.compute_paused();

        if (this.suspended) return;

        try {
            const result = this.generator_step();
            const value = result.value;

            if (value && typeof value === "object" && hasOwn.call(value, "__await")) {
                const awaitable = value.__await;
                this.invoke_promise(awaitable);
                return;
            }

            return Promise.resolve(value).then(unwrapped => {
                // When a yielded Promise is resolved, its final value becomes
                // the .value of the Promise<{value,done}> result for the
                // current iteration.
                result.value = unwrapped;
                this.resolve(result.value);
            }, (error) => {
                // If a rejected Promise was yielded, throw the rejection back
                // into the async generator function so it can be handled there.
                return this.invoke("throw", error);
            });
        } catch (ex) {
            this.reject(ex);
        }
    }

    private invoke_promise(awaitable: PromiseLike<any>) {
        if (typeof awaitable != 'object' || !("then" in awaitable)) awaitable = Promise.resolve(awaitable);

        this.pending_promise = awaitable;

        const then_args: any[] = [
            (value) => {
                this.pending_promise = null;
                this.invoke("next", value)
            },
            (err) => {
                this.pending_promise = null;
                this.invoke("throw", err);
            },
        ]

        if (awaitable instanceof ResumablePromise) {
            then_args.push(this);
        }

        return awaitable.then(...then_args);
    }

    private generator_step() {
        while (true) {
            if (this.actionType === "next") {
                this.sent = this.arg;

            } else if (this.actionType === "throw") {
                this.dispatchException(this.arg);

            } else if (this.actionType === "return") {
                this.abrupt("return", this.arg);
            }

            try {
                const result = this.generator.call(this.self, this);
                if (result === ContinueSentinel) {
                    continue;
                }
                return {
                    value: result,
                    done: this.done
                };
            } catch (err) {
                // Dispatch the exception by looping back around to the
                // context.dispatchException(context.arg) call above.
                this.actionType = "throw";
                this.arg = err;
            }
        }
    }

    stop() {
        this.done = true;

        const rootEntry = this.tryEntries[0];
        const rootRecord = rootEntry.completion;
        if (rootRecord.type === "throw") {
            throw rootRecord.arg;
        }

        return this.rval;
    }

    dispatchException(exception) {
        if (this.done) {
            throw exception;
        }

        let record;

        const context = this;
        function handle(loc, caught?) {
            record.type = "throw";
            record.arg = exception;
            context.next = loc;

            if (caught) {
                // If the dispatched exception was caught by a catch block,
                // then let that catch block handle the exception normally.
                context.actionType = "next";
                context.arg = undefined;
            }

            return !!caught;
        }

        for (let i = this.tryEntries.length - 1; i >= 0; --i) {
            const entry = this.tryEntries[i];
            record = entry.completion;

            if (entry.tryLoc === "root") {
                // Exception thrown outside of any try block that could handle
                // it, so set the completion value of the entire function to
                // throw the exception.
                return handle("end");
            }

            if (entry.tryLoc <= this.prev) {
                const hasCatch = hasOwn.call(entry, "catchLoc");
                const hasFinally = hasOwn.call(entry, "finallyLoc");

                if (hasCatch && hasFinally) {
                    if (this.prev < entry.catchLoc) {
                        return handle(entry.catchLoc, true);
                    } else if (this.prev < entry.finallyLoc) {
                        return handle(entry.finallyLoc);
                    }

                } else if (hasCatch) {
                    if (this.prev < entry.catchLoc) {
                        return handle(entry.catchLoc, true);
                    }

                } else if (hasFinally) {
                    if (this.prev < entry.finallyLoc) {
                        return handle(entry.finallyLoc);
                    }

                } else {
                    throw new Error("try statement without catch or finally");
                }
            }
        }
    }

    abrupt(type, arg) {
        let finallyEntry;
        for (let i = this.tryEntries.length - 1; i >= 0; --i) {
            const entry = this.tryEntries[i];
            if (entry.tryLoc <= this.prev &&
                hasOwn.call(entry, "finallyLoc") &&
                this.prev < entry.finallyLoc) {
                finallyEntry = entry;
                break;
            }
        }

        if (finallyEntry && (type === "break" || type === "continue") && finallyEntry.tryLoc <= arg && arg <= finallyEntry.finallyLoc) {
            // Ignore the finally entry if control is not jumping to a
            // location outside the try/catch block.
            finallyEntry = null;
        }

        const record = finallyEntry ? finallyEntry.completion : {};
        record.type = type;
        record.arg = arg;

        if (finallyEntry) {
            this.actionType = "next";
            this.next = finallyEntry.finallyLoc;
            return ContinueSentinel;
        }

        return this.complete(record);
    }

    complete(record, afterLoc?) {
        if (record.type === "throw") {
            throw record.arg;
        }

        if (record.type === "break" || record.type === "continue") {
            this.next = record.arg;
        } else if (record.type === "return") {
            this.rval = this.arg = record.arg;
            this.actionType = "return";
            this.next = "end";
        } else if (record.type === "normal" && afterLoc) {
            this.next = afterLoc;
        }

        return ContinueSentinel;
    }

    _catch(tryLoc) {
        for (let i = this.tryEntries.length - 1; i >= 0; --i) {
            const entry = this.tryEntries[i];
            if (entry.tryLoc === tryLoc) {
                const record = entry.completion;
                let thrown;
                if (record.type === "throw") {
                    thrown = record.arg;
                    this.resetTryEntry(entry);
                }
                return thrown;
            }
        }

        // The context.catch method must only be called with a location
        // argument that corresponds to a known catch block.
        throw new Error("illegal catch attempt");
    }

    finish(finallyLoc) {
        for (let i = this.tryEntries.length - 1; i >= 0; --i) {
            const entry = this.tryEntries[i];
            if (entry.finallyLoc === finallyLoc) {
                this.complete(entry.completion, entry.afterLoc);
                this.resetTryEntry(entry);
                return ContinueSentinel;
            }
        }
    }

    protected resetTryEntry(entry) {
        const record = entry.completion || {};
        record.type = "normal";
        delete record.arg;
        entry.completion = record;
    }

    private reset(skipTempReset) {
        this.prev = 0;
        this.next = 0;
        this.sent = undefined;
        this.done = false;
        // this.delegate = null;

        this.actionType = "next";
        this.arg = undefined;

        for (let tent of this.tryEntries) {
            this.resetTryEntry(tent);
        }

        if (!skipTempReset) {
            for (const name in this) {
                // Not sure about the optimal order of these conditions:
                if (name.charAt(0) === "t" &&
                    hasOwn.call(this, name) &&
                    !isNaN(+name.slice(1))) {
                    this[name] = undefined;
                }
            }
        }
    }
}

/**
 * Mark a method as resumable. When the app or TypeDaemon shutdown, the current execution
 * state will be saved and reloaded when the app starts again.
 * 
 * NB: All variables must be JSON serializable.
 */
export const resumable = (f, context: ClassMethodDecoratorContext) => {
    function scope_wrapped(...args) {
        const executor: Executor<any> = f.call(this, ...args);
        executor['scope'] = {
            owner: this,
            method: context.name as string,
            parameters: args,
        }

        return executor;
    }

    function start_wrapped(...args) {
        const executor = scope_wrapped.call(this, ...args);
        executor.start();
        return executor;
    }

    start_wrapped[UNSTARTED_EXEC] = f;

    return start_wrapped;
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

resumable._wrapped_async = (innerFn, options) => {
    return new Executor(innerFn, options);
}

resumable._awrap = (value) => {
    return { __await: value };
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
