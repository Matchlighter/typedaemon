import { randomUUID } from "crypto";

import { ControlledPromise } from "@matchlighter/common_library/promises";

import type { AppLifecycle } from "../../hypervisor/application_instance";
import { current } from "../../hypervisor/current";
import { notePluginAnnotation } from "../../plugins/base";
import { Executor } from "../regen_executor";
import { EXECUTOR_FACTORY, ResumableMethod } from "../resumable/resumable_method";
import { ICancellablePromise, PromiseCancelled } from "../resumable/resumable_promise";

import { hookScriptCallback, ResumableScriptStoreManager } from "./resumable";
import { ScriptOptions, ScriptStateStore } from "./store";

type ShutdownCleanerFactory = (executor: Executor<any>, store: ScriptStateStore, complete: PromiseLike<any>) => () => Promise<void>;

/** Per-`shutdown` mode cleaner, registered on the app for each non-resumable run */
const SHUTDOWN_CLEANERS: Partial<Record<ScriptOptions["shutdown"], ShutdownCleanerFactory>> = {
    kill: (executor) => async () => {
        executor.cancel(new Error("Script killed due to application shutdown"));
    },
    // Hold shutdown until the run completes (no timeout). Queued runs are cancelled rather than started.
    wait: (_executor, store, complete) => async () => {
        store.cancelPending(new PromiseCancelled("Script cancelled due to application shutdown"));
        await complete.then(() => { }, () => { });
    },
};

const SHUTTING_DOWN_STATES: ReadonlySet<AppLifecycle> = new Set(["stopping", "stopped", "dead"]);
const isShuttingDown = () => SHUTTING_DOWN_STATES.has(current.application?.state);

export function script(options: ScriptOptions) {
    // Typed generically over the decorated method so TS accepts it on async methods (TS1270).
    // NB: at runtime a rejected single/queued invocation returns `false`; that can't be expressed
    // while remaining assignable to the original method type.
    function decorator<This, Args extends any[], R>(
        f: (this: This, ...args: Args) => R,
        context?: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => R>,
    ): (this: This, ...args: Args) => R & ICancellablePromise;
    function decorator(f: Function, context?: ClassMethodDecoratorContext): any {
        const sid = context?.name.toString() ?? randomUUID();

        let lookupStore: (ukey: string) => ScriptStateStore;

        if (options.shutdown == "suspend") {
            if (!context) throw new Error("May only use script({ shutdown: 'suspend' }) as a decorator!");

            start_wrapped[EXECUTOR_FACTORY] = f;

            lookupStore = (ukey: string) => {
                const superStore = ResumableScriptStoreManager.current();
                return superStore.lookupStore(sid, ukey);
            }

            // Make sure to save/load the queue on shutdown/startup
            notePluginAnnotation(context, async (self) => {
                const superStore = ResumableScriptStoreManager.current();
                await superStore.defineSubStore(sid, options);
            })
        } else {
            const local_store = {};
            lookupStore = (ukey: string) => {
                local_store[ukey] ??= new ScriptStateStore(options);
                return local_store[ukey];
            }
        }

        function start_wrapped(...args): false | (PromiseLike<any> & ICancellablePromise) {
            const ukey = typeof options.mode_key === "function" ? options.mode_key(args) : context?.name.toString() ?? "-";
            const store = lookupStore(ukey);

            // Don't start work that shutdown handling would miss
            if (SHUTDOWN_CLEANERS[options.shutdown] && isShuttingDown()) return false;

            if (store.configuration.mode == "restart") {
                store.makeRoom(new PromiseCancelled("The Script has been called again, aborting this previous run."));
            } else if (store.total_count >= store.limit) {
                return false;
            }

            const executor: Executor<any> = f.call(this, ...args);

            if (options.shutdown == 'suspend') {
                const rmthd = new ResumableMethod(executor);
                rmthd.scope = {
                    owner: this,
                    method: context.name as string,
                    parameters: args,
                }

                // Apply a special `then` that persists/manages the counting state
                hookScriptCallback(rmthd, { sid, ukey });

                // NO! `hookScriptCallback` handles pushing to the queue
                // // store.push(rmthd);
                store.refill();

                return rmthd;
            } else {
                const complete_promise = new ControlledPromise();

                executor.on_completed = (success, result) => {
                    store.checkin(executor);
                    if (success) {
                        complete_promise.resolve(result);
                    } else {
                        complete_promise.reject(result);
                    }
                };

                const script_cleaner = SHUTDOWN_CLEANERS[options.shutdown]?.(executor, store, complete_promise);
                if (script_cleaner) {
                    const cleanups = current.application.cleanups.unorderedGroup(`script:${options.shutdown}`);
                    cleanups.push(script_cleaner);

                    const old_on_completed = executor.on_completed;
                    executor.on_completed = (...args) => {
                        cleanups.remove(script_cleaner);
                        old_on_completed?.(...args);
                    }
                }

                store.trackPending(executor);
                store.refill();

                return {
                    then: (onfulfilled, onrejected) => {
                        return complete_promise.then(onfulfilled, onrejected);
                    },
                    cancel: (reason?: any) => {
                        executor.cancel(reason);
                    },
                }
            }
        }

        return start_wrapped;
    }

    return decorator;
}
