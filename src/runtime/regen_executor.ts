import { ResumablePromise } from "./resumable";
import { PromiseCancelled } from "./resumable/resumable_promise";

type ResumableMethodAction = 'next' | 'return' | 'throw';

export interface ExecutorOptions {
    self: any;
    try_locs: number[][];
    marked_locs: number[];
    context_name?: string;
    parameter_names?: string[];
}

const Op = Object.prototype;
const hasOwn = Op.hasOwnProperty;

const ContinueSentinel = Symbol("continue");

export class Executor<T> {
    constructor(generator, readonly options: ExecutorOptions) {
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

    owner: ResumablePromise = null;
    pre_step_hook: () => boolean;
    await_promise_hook: (awaitable: PromiseLike<any>, then_args) => PromiseLike<any> = (awaitable, then_args) => awaitable.then(...then_args);
    on_completed: (success: boolean, value?: T) => void;

    self: any;
    generator;

    state: any = {};
    pending_promise;

    arg;
    sent;
    actionType: ResumableMethodAction = "next";
    prev: number;
    next: number | "end";
    done = false;
    rval: T;

    readonly tryEntries: any[];

    _started = false;
    start() {
        if (this._started) throw new Error("Already Started!");
        this._started = true;
        this.invoke('next');
    }

    cancel(reason?: any) {
        if (!reason || typeof reason === 'string') {
            reason = new PromiseCancelled(reason);
        }

        this.injectError(reason);

        if (this.pending_promise && this.pending_promise.cancel) {
            this.pending_promise.cancel(reason);
            this.pending_promise = null;
        }
    }

    _injected_error: any = null;
    injectError(error: any) {
        this._injected_error = error;
    }

    invoke(method: ResumableMethodAction, arg?) {
        this.actionType = method;
        this.arg = arg;

        if (this._injected_error) {
            // If an error was injected, we should throw it immediately.
            this.actionType = "throw";
            this.arg = this._injected_error;
            this._injected_error = null;
        } else if (this.pre_step_hook) {
            if (!this.pre_step_hook()) return;
        }

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
                this.on_completed?.(true, result.value);
            }, (error) => {
                // If a rejected Promise was yielded, throw the rejection back
                // into the async generator function so it can be handled there.
                return this.invoke("throw", error);
            });
        } catch (ex) {
            this.on_completed?.(false, ex);
        }
    }

    invoke_promise(awaitable: PromiseLike<any>) {
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

        return this.await_promise_hook(awaitable, then_args);
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

    static _wrapped_async = (innerFn, options) => {
        return new Executor(innerFn, options);
    }

    static _awrap = (value) => {
        return { __await: value };
    }
}
