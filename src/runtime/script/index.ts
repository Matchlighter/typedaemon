import { randomUUID } from "crypto";

import { ControlledPromise } from "@matchlighter/common_library/promises";

import { current } from "../../hypervisor/current";
import { notePluginAnnotation } from "../../plugins/base";
import { Executor } from "../regen_executor";
import { EXECUTOR_FACTORY, ResumableMethod } from "../resumable/resumable_method";
import { ICancellablePromise } from "../resumable/resumable_promise";

import { hookScriptCallback, ResumableScriptStoreManager } from "./resumable";
import { ScriptOptions, ScriptStateStore } from "./store";

export function script(options: ScriptOptions) {
    function decorator(f: Function, context?: ClassMethodDecoratorContext) {
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
            notePluginAnnotation(f, async (self) => {
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

            if (store.total_count >= store.limit) {
                if (store.configuration.mode == "restart") {
                    store.cancelOldest();
                } else {
                    return false;
                }
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

                if (options.shutdown == 'kill') {
                    // Register cleaner to kill the executor
                    const cleanups = current.application.cleanups.unorderedGroup("script:killers");
                    const script_cleaner = async () => {
                        executor.cancel(new Error("Script killed due to application shutdown"));
                    };
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
