
// TODO Move to @matchlighter/common_library

import { ClassMethodDecorator } from "./decorator_fills";

export interface AsyncLimiterState {
    readonly key: string;

    working: boolean;
    nextCallParams: any;
    nextCallTimer: any;

    last_call: number
    initial_call: number
    last_exec: number
}

export interface LimiterFunction {
    (state: AsyncLimiterState): number;
}

interface GenericLimiterOptions<P extends any[] = any[]> {
    key_on?: number[] | ((params: P) => string);
    limiter_logic: (options: any) => LimiterFunction;
}

export const async_limiter = <T extends (...params: any[]) => void>(options: GenericLimiterOptions, func: T): T => {
    const limiter = options.limiter_logic(options);
    const states: Record<string, AsyncLimiterState> = {};

    function getState(params: Parameters<T>) {
        let key = "DEFAULT"
        if (typeof options.key_on == 'function') {
            key = options.key_on(params);
        } else if (options.key_on) {
            key = options.key_on.map(i => params[i]).join('|');
        }

        return states[key] ||= {
            key,
            working: false,
            nextCallParams: null,
            nextCallTimer: null,

            initial_call: 0,
            last_call: 0,
            last_exec: 0,
        }
    }

    async function workOrScheduleTask(state: AsyncLimiterState) {
        if (state.working) return;

        if (!state.nextCallParams) {
            delete states[state.key];
            return
        };

        let nextCallTime = limiter(state);

        if (nextCallTime < Date.now()) {
            state.working = true;

            state.initial_call = null;
            state.last_exec = Date.now();

            const p = state.nextCallParams;
            state.nextCallParams = null;
            try {
                await func.call(p.self, ...p.parameters);
                // } catch {
            } finally {
                state.working = false;
            }

            workOrScheduleTask(state);
        } else {
            clearTimeout(state.nextCallTimer);
            state.nextCallTimer = setTimeout(() => workOrScheduleTask(state), nextCallTime - Date.now());
        }
    }

    return function limited(...args: Parameters<T>) {
        const state = getState(args);
        state.last_call = Date.now();
        state.initial_call ||= state.last_call;
        state.nextCallParams = { self: this, parameters: args };
        workOrScheduleTask(state);
    } as any
}

export function limiter_decorator_combo<T extends (options: any) => LimiterFunction>(limiter: T) {
    type LimitOptions = Parameters<T>[0];

    function limit<P extends any[]>(options: LimitOptions & Omit<GenericLimiterOptions<P>, "limiter_logic">): ClassMethodDecorator<any, (...p: P) => any>
    function limit<P extends any[], T extends (...params: P) => void>(options: LimitOptions & Omit<GenericLimiterOptions<P>, "limiter_logic">, func: T): T
    function limit(options, func?) {
        const resolvedOptions: GenericLimiterOptions = {
            ...options,
            limiter_logic: limit.limiting_logic,
        }
        if (func) {
            return async_limiter(resolvedOptions, func);
        } else {
            return (func, context: ClassMethodDecoratorContext<any, () => any>) => {
                const limited = async_limiter(resolvedOptions, func);
                return function (...args) {
                    return limited.call(this, ...args);
                }
            }
        }
    }

    limit.limiting_logic = limiter;

    return limit;
}

const throttle_limiter = ({ interval }: { interval: number }): LimiterFunction => ({ last_exec }) => (last_exec || 0) + interval;
export const throttle = limiter_decorator_combo(throttle_limiter);

const debounce_limiter = ({ timeToStability, maxTime = Infinity }: { timeToStability: number, maxTime?: number }): LimiterFunction => ({ initial_call, last_call }) => Math.min(last_call + timeToStability, initial_call + maxTime);
export const debounce = limiter_decorator_combo(debounce_limiter);
