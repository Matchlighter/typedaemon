import { current } from "../hypervisor/current";
import { appmobx } from "../plugins/mobx";
import { ResumablePromise } from "./resumable";
import { ResumableMethod } from "./resumable/resumable_method";
import { SerializeContext } from "./resumable/resumable_promise";

interface WaitOptions {
    /** Indicates a timeout when used as `await wait()` */
    timeout?: number;
    for?: number;
}

export function wait(expr: (() => boolean) | string, options: WaitOptions = {}) {
    return new StateWaiter(expr, options);
}

class StateWaiter extends ResumablePromise<void> {
    constructor(private expr: (() => boolean) | string, private options: WaitOptions = {}) {
        super();
    }

    static {
        ResumablePromise.defineClass({
            type: 'wait',
            resumer: (data) => {
                const { expr, ...rest } = data;
                return new StateWaiter(expr, rest);
            },
        })
    }

    private evaluate_expression(context: ResumableMethod<any>) {
        if (typeof this.expr === "string") {
            try {
                const executor = context.executor;
                const scope = {
                    _this: context?.scope?.owner,
                    [executor.options.context_name]: executor,
                }
                if (executor.options.parameter_names) {
                    for (let i = 0; i < executor.options.parameter_names.length; i++) {
                        scope[executor.options.parameter_names[i]] = context?.scope?.parameters[i];
                    }
                }
                const res = current.application.appModule._eval_in_module(this.expr, scope);
                return res();
            } catch (e) {
                // NB: This should result in the promise hanging in limbo, and then being saved as is (so it has another chance to work after reboot)
                console.error("Error evaluating wait expression:", e);
                return null;
            }
        } else {
            return this.expr();
        }
    }

    private _initialized = false;

    then<TResult1 = void, TResult2 = never>(onfulfilled?: (value: void) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>, resumable?: ResumablePromise<any> | boolean): Promise<TResult1 | TResult2> {
        if (!this._initialized && resumable instanceof ResumableMethod) {
            this._initialized = true;
            // TODO: `for` should support a string
            if (!this.options.for) {
                appmobx.when(() => this.evaluate_expression(resumable), {
                    timeout: this.options.timeout ? this.options.timeout * 1000 : undefined,
                }).then(this._resolve, this._reject);
            } else {
                let tmr: any;

                const reaction = appmobx.reaction(() => this.evaluate_expression(resumable), (value, reaction) => {
                    if (value) {
                        tmr ??= setTimeout(() => {
                            reaction.dispose();
                            this._resolve();
                        });
                    } else {
                        tmr && clearTimeout(tmr);
                        tmr = null;
                    }
                }, { fireImmediately: true });

                if (this.options.timeout) {
                    const cancelTimer = setTimeout(() => {
                        tmr && clearTimeout(tmr);
                        tmr = null;
                        reaction();
                        this._reject(new Error("Timeout"));
                    }, this.options.timeout * 1000);
                    this.finally(() => clearTimeout(cancelTimer));
                }
            }
        }
        return super.then(onfulfilled, onrejected, resumable);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type("wait");
        ctx.side_effects(false);
        return {
            expr: typeof this.expr === "string" ? this.expr : this.expr.toString(),
            // TODO: timeout should be converted to a timestamp
            timeout: this.options.timeout,
            for: this.options.for,
        }
    }
}
