import { ResumablePromise, Suspend } from "./resumable_promise";

const Op = Object.prototype;
const hasOwn = Op.hasOwnProperty;

const ContinueSentinel = Symbol("continue");

type ResumableMethod = 'next' | 'return' | 'throw';

class Executor<T> extends ResumablePromise<T> {
    constructor(generator, tryLocsList: any[]) {
        super();

        this.generator = generator;

        // The root entry object (effectively a try statement without a catch
        // or a finally block) gives us a place to store values thrown from
        // locations where there is no enclosing try statement.
        this.tryEntries = [{ tryLoc: "root" }];
        for (let locs of tryLocsList) {
            const entry: any = { tryLoc: locs[0] };

            if (1 in locs) {
                entry.catchLoc = locs[1];
            }

            if (2 in locs) {
                entry.finallyLoc = locs[2];
                entry.afterLoc = locs[3];
            }

            this.tryEntries.push(entry);
        }

        this.reset(true);

        this.invoke('next');
    }

    private method: ResumableMethod;
    private pending_promise;

    private scope;

    arg;
    sent;
    _sent;

    private rval: T;

    generator;
    self: any;

    state: any = {};

    prev: number;
    next: number | "end";
    done = false;

    tryEntries: any[];

    serialize() {
        if (!(this.pending_promise instanceof ResumablePromise)) {
            throw new Error("Can't Happen... theoretically")
        }

        return {
            type: "@resumable",
            awaiting: { uid: this.pending_promise.uid },
            scope: { // TODO
                owner: this.self.resumable_context_key,
                method: this.scope.method_name,
                parameters: [], // TODO
            },
            state: this.state,
            prev: this.prev,
            next: this.next,
        }
    }

    can_suspend() {
        if (!super.can_suspend()) return false;
        // TODO If state is not POJSO, return false
        return true;
    }

    private invoke(method: ResumableMethod, arg?) {
        this.method = method;
        this.arg = arg;

        try {
            const result = this.generator_step();
            const value = result.value;

            if (value && typeof value === "object" && hasOwn.call(value, "__await")) {
                const pcontext = runtime._resumable_context;
                try {
                    runtime._resumable_context = this;
                    let awaitable = value.__await;
                    if (!("then" in awaitable)) awaitable = Promise.resolve(awaitable);

                    this.pending_promise = awaitable;

                    return awaitable.then((value) => {
                        this.invoke("next", value);
                    }, (err) => {
                        if (err instanceof Suspend) {
                            // TODO Serialize. Should this be triggered here, or by the code that throws Suspend?
                        } else {
                            this.invoke("throw", err);
                        }
                    });
                } finally {
                    runtime._resumable_context = pcontext;
                }
            }

            return Promise.resolve(value).then(unwrapped => {
                // When a yielded Promise is resolved, its final value becomes
                // the .value of the Promise<{value,done}> result for the
                // current iteration.
                result.value = unwrapped;
                this._resolve(result.value);
            }, (error) => {
                // If a rejected Promise was yielded, throw the rejection back
                // into the async generator function so it can be handled there.
                return this.invoke("throw", error);
            });
        } catch (ex) {
            this._reject(ex);
        }
    }

    private generator_step() {
        while (true) {
            if (this.method === "next") {
                this.sent = this._sent = this.arg;

            } else if (this.method === "throw") {
                this.dispatchException(this.arg);

            } else if (this.method === "return") {
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
                this.method = "throw";
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
                context.method = "next";
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
            this.method = "next";
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
            this.method = "return";
            this.next = "end";
        } else if (record.type === "normal" && afterLoc) {
            this.next = afterLoc;
        }

        return ContinueSentinel;
    }

    catch(tryLoc) {
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
        // Resetting context._sent for legacy support of Babel's
        // function.sent implementation.
        this.sent = this._sent = undefined;
        this.done = false;
        // this.delegate = null;

        this.method = "next";
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

export const runtime = global['resumable_runtime'] = {
    _resumable_context: null,

    async(innerFn, self, tryLocsList?) {
        const executor = new Executor(innerFn, tryLocsList);
        return executor;
    },

    awrap(value) {
        return { __await: value };
    },
}
