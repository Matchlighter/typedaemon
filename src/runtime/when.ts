
import { notePluginAnnotation } from "../plugins/base";
import { appmobx } from "../plugins/mobx";
import { current } from "../hypervisor/current";
import { on } from "events";
import { ControlledPromise } from "@matchlighter/common_library/promises";

interface RepeatConfig {
    /** The interval (in seconds) between repeats */
    interval?: number;
    /** The maximum number of times to repeat (including the first call) */
    times?: number;
    /** The maximum amount of time (in seconds) to repeat over */
    duration?: number;
}

interface ResumeConfig {
    id?: string;
    /** An amount of time (in seconds) after which the timers will not be resumed */
    max?: number;
}

interface WhenOptions {
    /** The expression must remain true for so many seconds before invoking the function */
    for?: number;

    /** Continue calling the function as long as the expression is true */
    repeat?: boolean | RepeatConfig;

    /** Indicates that the `for`/`repeat` timer should be maintained across restarts */
    resume?: boolean | ResumeConfig;

    /** Indicates a timeout when used as `await when()` */
    timeout?: number;
}

interface WhenDecorator<S> extends PromiseLike<any> {
    (callback: (self: S) => boolean): (() => void);
    (decoratee: any, ctx: ClassMethodDecoratorContext<S>): void;
}

function normalizeOptions(options: WhenOptions) {
    let repeat: RepeatConfig;

    if (options.repeat === true) {
        repeat = {}
    } else if (options.repeat) {
        repeat = { ...options.repeat };
    }

    if (repeat) {
        repeat.interval ??= options.for;

        if (repeat.interval <= 0) {
            throw new Error("Interval must be greater than 0");
        }
    }

    let resume: ResumeConfig;
    if (options.resume === true) {
        resume = { max: null };
    } else if (options.resume) {
        resume = { ...options.resume };
    }

    return {
        for: options.for ?? 0,
        repeat,
        resume,
    }
}

/** Evaluate the function/method when the expr becomes true, optionally for an amount of time */
export function when<S>(
    expr: (self: S) => boolean,
    options?: WhenOptions,
) {
    const opts = normalizeOptions(options ?? {});

    const connect = (self, target) => {
        const app = current.application;

        let state: {
            active_timestamp: number;
            last_timestamp: number;
            count: number;
        } = null;

        let timer = null;
        let callbackIsRunning = false;

        if (opts.resume && !opts.resume.id) {
            throw new Error("resume: { id: } is required");
        }

        const write_state = () => {
            if (!opts.resume) return;
            app.persistedStorage.objectSet(`td:whens`, opts.resume.id, state || undefined, { min_time_to_disk: 10, max_time_to_disk: 60 });
        }

        const clear_state = () => {
            state = null;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            write_state();
        }

        const schedule_next = () => {
            write_state();

            if (!state) return;

            const toff = state.count == 0 ? opts.for : opts.repeat?.interval ?? 0;
            const next_timestamp = state.last_timestamp + (toff * 1000);
            let diff = next_timestamp - Date.now();

            if (diff < 0) diff = 0;

            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            if (state.count == 0 || (
                opts.repeat && state.count < (opts.repeat.times ?? Infinity) && (!opts.repeat.duration || (next_timestamp - state.active_timestamp) < opts.repeat.duration * 1000)
            )) {
                timer = setTimeout(run, diff);
            }
        }

        const run = async () => {
            timer = null;
            if (!state) return;

            state.count++;
            state.last_timestamp = Date.now();

            schedule_next();

            if (callbackIsRunning) {
                console.warn("Callback is already running, skipping this run");
                return;
            }

            callbackIsRunning = true;
            try {
                await target(self);
            } finally {
                callbackIsRunning = false;
            }
        };

        if (opts.resume) {
            // TODO Cleanup of ancient/forgotten IDs would be good

            const allwhens = app.persistedStorage.getValue(`td:whens`) || {};
            state = allwhens[opts.resume.id] || null;

            if (state && opts.resume.max) {
                const time_since_last = (Date.now() - state.last_timestamp);

                if (time_since_last / 1000 > opts.resume.max) {
                    console.warn(`Resuming when '${opts.resume.id}' is too old, skipping`);
                    clear_state();
                }
            }
        }

        const dispose = appmobx.reaction(() => expr(self), (isTrue) => {
            if (!isTrue) {
                clear_state();
                return;
            }

            state ??= {
                active_timestamp: Date.now(),
                last_timestamp: Date.now(),
                count: 0,
            }

            schedule_next();

        }, { fireImmediately: !!state });

        return () => {
            dispose();
            clear_state();
        }
    }

    const dec: WhenDecorator<S> = (target, context?) => {
        if (options?.timeout) {
            throw new Error("Cannot use `timeout:` option with decorator usage of `when`");
        }

        if (context) {
            if (opts.resume) opts.resume.id ??= `decorated-method:${context.name}`;
            notePluginAnnotation(target, (self) => {
                const inst_method: Function = self[context.name];
                connect(self, inst_method.bind(self));
            })
        } else {
            return connect(undefined, target);
        }
    }

    // dec.then = (onfulfilled, onrejected?) => {
    //     if (options.resume || options.repeat) {
    //         throw new Error("Cannot use `await when(...)` with `resume:` or `repeat:` options");
    //     }

    //     if (options.for && options.for > 0) {
    //         const p = new ControlledPromise();
    //         const app_inst = current.application.instance as any;
    //         appmobx.reaction(() => expr(app_inst), (x) => {

    //         }, { fireImmediately: true });
    //     } else {
    //         // Optimize for the common case of no `for` time
    //         return appmobx.when(() => expr(current.application.instance as any)).then(
    //             onfulfilled,
    //             onrejected,
    //         )
    //     }
    // }

    return dec;
}
