
import * as ne from "nearley"

import { current } from "../../hypervisor/current";
import { callback_or_decorator2 } from "./util";

import grammar_cmp from "./schedule_grammar"
import { sleep } from "../..";
import { ResumableCallbackPromise } from "../resumable/resumable_method";
import { sleep_until } from "../../plugins/builtin/sleep";

const grammar = ne.Grammar.fromCompiled(grammar_cmp)

function isCronValid(freq) {
    var cronregex = new RegExp(/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/);
    return cronregex.test(freq);
}

export type Schedule = {

}

export interface SchedulerHandler {
    (): void;
}

/**
 * Helper to schedule future tasks.
 * 
 * Accepts a Cron-format string, or a string in one of the following formats:
 * - `2023/05/30 4:23:00 PM`
 * - `2023/05/30 16:23:00`
 * - `4:23:00 PM`
 * 
 * Any numeric component can be replaced with a `*` or a cron-like pattern in curly braces, like so:
 * `{*}/{9-12/2}/{1,15} *:30:00 PM`
 * 
 * Schedules can also be created relative to sunrise or sunset:
 * - `2023/05/30 sunset+1:00`
 * - `2023/05/30 sunrise-1:00:30`
 * - `sunrise-1:00:30`
 */
export const schedule = callback_or_decorator2((func: SchedulerHandler, sched: Schedule) => {
    if (typeof sched == "string") {
        if (sched.match(/\d+ ?(h|m|s|d|w)/)) {
            // TODO Is it run_every or run_in? Should it just not be supported here?
            // https://www.npmjs.com/package/parse-duration
            // 1 hour
        } else if (isCronValid(sched)) {
            // https://www.npmjs.com/package/cron-parser
        } else {
            // 2023/05/30 4:23:00 PM
            // 16:23:00
            // 4:23:00 PM
            // 4:23 PM
            // */*/{15,30} 4:23:00 PM
            // */{5-8}/10 4:23:00 PM
            // */{*/3}/10 4:23:00 PM
            // */{*}/10 4:23:00 PM

            // */{*}/10 sunset+4:23:00

            const parser = new ne.Parser(grammar);
            parser.feed(sched);
            const parsed = parser.results[0];
        }
    }

    if (sched instanceof Date) {
        // Run once at the date
    }

    if (typeof sched == "object") {

    }
})

const schedule_cleanups = () => current.application.cleanups.unorderedGroup("schedules");

function runAtDate(date: Date, func: () => any) {
    const now = (new Date()).getTime();
    const then = date.getTime();
    const diff = Math.max((then - now), 0);
    if (diff > 0x7FFFFFFF) // setTimeout limit is MAX_INT32=(2^31-1)
        return setTimeout(function () { runAtDate(date, func); }, 0x7FFFFFFF);
    else
        return setTimeout(func, diff);
}

function scheduleTimer(when: Date, callback: () => any) {
    const handle = runAtDate(when, callback);
    const cleanup = () => {
        clearTimeout(handle);
        schedule_cleanups().pop(cleanup);
    }
    schedule_cleanups().push(cleanup);
    return cleanup;
}

export function run_in(period: string) {
    const sleep_time = 10; // TODO Parse period
    const func = (cb) => scheduleTimer(new Date(Date.now() + sleep_time * 1000), cb)

    func.persisted = (action: string) => {
        const sleep_prom = sleep(sleep_time);
        new ResumableCallbackPromise(sleep_prom, action);
        return () => sleep_prom.cancel();
    }

    return func
}

export function run_at(time: string) {
    const run_time: Date = null; // TODO Parse time
    const func = (cb) => scheduleTimer(run_time, cb);

    func.persisted = (action: string) => {
        const sleep_prom = sleep_until(run_time);
        new ResumableCallbackPromise(sleep_prom, action);
        return () => sleep_prom.cancel();
    }

    return func
}

export function run_every(period: string) {
    // TODO
}
