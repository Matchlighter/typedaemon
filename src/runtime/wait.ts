import { current } from "../hypervisor/current";
import { appmobx } from "../plugins/mobx";
import { ResumablePromise } from "./resumable";
import { ResumableMethod } from "./resumable/resumable_method";
import { SerializeContext } from "./resumable/resumable_promise";

export function wait(expr: () => boolean, options: { timeout?: number } = {}): Promise<void> {

}

class StateWaiter extends ResumablePromise<void> {
    constructor(private expr: (() => boolean) | string, private options: { timeout?: number, for?: number } = {}) {
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
            const executor = context.executor;
            const scope = {
                _this: context?.scope?.owner,
                [executor.options.context_name]: executor.state,
            }
            const res = current.application.appModule._eval_in_module(this.expr, scope);
            return res();
        } else {
            return this.expr();
        }
    }

    private _initialized = false;

    then<TResult1 = void, TResult2 = never>(onfulfilled?: (value: void) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>, resumable?: ResumablePromise<any> | boolean): Promise<TResult1 | TResult2> {
        if (!this._initialized && resumable instanceof ResumableMethod) {
            this._initialized = true;
            appmobx.when(() => this.evaluate_expression(resumable), {
                timeout: this.options.timeout ? this.options.timeout * 1000 : undefined,
            }).then(this._resolve, this._reject);
        }
        return super.then(onfulfilled, onrejected, resumable);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type("wait");
        ctx.side_effects(false);
        return {
            expr: typeof this.expr === "string" ? this.expr : this.expr.toString(),
            timeout: this.options.timeout,
            for: this.options.for,
        }
    }
}
