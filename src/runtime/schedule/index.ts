
import * as cron from "cron-parser";
import * as ne from "nearley";
import parse_duration from "parse-duration";
import * as SunCalc from "suncalc";
import moment = require("moment-timezone");

import { current } from "../../hypervisor/current";
import { callback_or_decorator2 } from "../../plugins/util";

import { sleep } from "../..";
import { bind_callback_env, get_plugin } from "../../plugins/base";
import { HomeAssistantPlugin } from "../../plugins/home_assistant/plugin";
import { ResumableCallbackPromise } from "../resumable/resumable_method";
import { sleep_until } from "../sleep";

import grammar_cmp from "./schedule_grammar";

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

type SunConfig = {
    lat,
    long,
    elev?,
}

type SunOptions = "td" | `ha:${string}` | SunConfig

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
export const schedule = callback_or_decorator2((func: SchedulerHandler, sched: Schedule, options?: { sun?: SunOptions }) => {
    const ctx = current.application;

    if (typeof sched == "string") {
        if (sched.match(/\d+ ?(h|m|s|d|w)/)) {
            // TODO Is it run_every or run_in? Should it just not be supported here?
            // https://www.npmjs.com/package/parse-duration
            const parsed = parse_duration(sched);
        } else if (isCronValid(sched)) {
            // https://www.npmjs.com/package/cron-parser
            const parsed = cron.parseExpression(sched, {})
            return scheduleRecurring(() => {
                parsed.reset(Date.now());
                return parsed.next().toDate();
            }, func)
        } else {
            const get_next = _parseTDFormat(sched, options?.sun);

            return scheduleRecurring(() => {
                const nextCronDate = get_next();
                return nextCronDate?.toDate();
            }, func)
        }
    }

    // Run once at the date
    if (sched instanceof Date) {
        return scheduleTimer(sched, func);
    }
})

export const _parseTDFormat = (sched: string, sun_options: SunOptions = "ha:default") => {
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

    parsed.date ||= { year: '*', month: '*', day: '*' };

    // TODO Addd year support (likely patch-package)

    const cfg = current.hypervisor?.currentConfig;

    // TODO TZ support in parser
    let tz = cfg?.location?.timezone || moment.tz.guess();

    // Sun-relative time
    if (parsed.time?.ref) {
        const srel_cron = cron.parseExpression(cronifyBits([
            "59",
            "59",
            "23",
            parsed.date.day,
            parsed.date.month,
            "*",
        ]), {
            tz,
        });

        const applySunOffset = (dt: moment.Moment, sunrel: { ref: keyof SunCalc.GetTimesResult, offset: any }) => {
            const mdt = dt.clone().tz(tz);
            const dtStart = mdt.clone().startOf('day');
            const dtEnd = mdt.clone().endOf('day');

            if (typeof sun_options == 'string' && sun_options.startsWith('ha:')) {
                let plg_name = sun_options.substring(3);
                if (plg_name == "default") plg_name = "home_assistant";
                const plg = get_plugin(plg_name) as HomeAssistantPlugin;
                
                if (plg?.ha_config) {
                    const hac = plg.ha_config;
                    sun_options = {
                        lat: hac.latitude,
                        long: hac.longitude,
                        elev: hac.elevation,
                    }
                } else {
                    sun_options = null;
                }
            }

            if (sun_options == "td" || !sun_options) {
                sun_options = {
                    lat: cfg?.location?.latitude,
                    long: cfg?.location?.longitude,
                    elev: cfg?.location?.elevation,
                }
            }

            if (!sun_options || typeof sun_options != "object") {
                throw new Error(`Tried to schedule something in relation to the sun, but could not determin lat/long. You need to configure HA or TypeDaemon appropriately.`);
            }

            const sun_config = sun_options as SunConfig;

            let chosen: moment.Moment;

            // suncalc is affected by the time-part of the passed Date and I'm not sure how to fix that cleanly
            const dateTrials = [0, -1, 1];
            for (let dto of dateTrials) {
                const mdto = mdt.clone();
                mdto.add(dto, 'days');

                const suntimes = SunCalc.getTimes(mdto.toDate(), sun_config.lat, sun_config.long, sun_config.elev);
                const refdt = suntimes[sunrel.ref];
                if (dtStart.isBefore(refdt) && dtEnd.isAfter(refdt)) {
                    chosen = toMoment(refdt);
                    break;
                }
            }

            const off = sunrel.offset
            if (off?.dir) {
                const mthd = sunrel.offset.dir == '+' ? "add" : "subtract";
                chosen[mthd](off.hour || 0, 'hours');
                chosen[mthd](off.minute || 0, 'minutes');
                chosen[mthd](off.second || 0, 'seconds');
            }

            return chosen;
        }

        return () => {
            srel_cron.reset(Date.now());

            let next_day = toMoment(srel_cron.next());
            next_day = applySunOffset(next_day, parsed.time);

            // Get sun___ on next_day. If past, bump next_day
            if (next_day.isBefore(Date.now())) {
                next_day = toMoment(srel_cron.next());
                next_day = applySunOffset(next_day, parsed.time);
            }

            return next_day;
        }

    } else {
        const cron_time = cron.parseExpression(cronifyBits([
            parsed.time.second || '0',
            parsed.time.minute,
            applyMeridian(parsed.time.hour, parsed.time.meridian),
            parsed.date.day,
            parsed.date.month,
            "*",
        ]), {
            tz,
        });

        return () => {
            cron_time.reset(Date.now());
            const next_time = cron_time.next();
            return next_time && toMoment(next_time)
        }
    }
}

const toMoment = (date: cron.CronDate | Date) => {
    if (date instanceof Date) {
        return moment(date)
    } else {
        return moment(date.toDate());
    }
}

const applyMeridian = (hour: any, meridian: 'AM' | 'PM') => {
    if (hour == '*') {
        if (meridian == 'AM') return { type: 'range', left: 0, right: 11 };
        if (meridian == 'PM') return { type: 'range', left: 12, right: 23 };
        return "*"
    };

    const diff = meridian == "PM" ? 12 : 0;
    if (typeof hour == 'string') hour = parseInt(hour);
    if (typeof hour == 'number') return hour + diff;
    if (Array.isArray(hour)) return hour.map(h => applyMeridian(h, meridian));
    if (hour.type == "range") return {
        ...hour,
        left: applyMeridian(hour.left, meridian),
        right: applyMeridian(hour.right, meridian),
    };
    if (hour.type == "modulo") return {
        ...hour,
        left: applyMeridian(hour.left, meridian),
    };
}

const cronifyBit = (bit) => {
    if (typeof bit == 'string') return bit;
    if (typeof bit == 'number') return String(bit);
    if (Array.isArray(bit)) return bit.join(',')
    if (bit.type == "range") return `${bit.left}-${bit.right}`;
    if (bit.type == "modulo") return `${cronifyBit(bit.left)}/${bit.right}`;
}

const cronifyBits = (bits: any[]) => {
    return bits.map(cronifyBit).join(' ')
}

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
    callback = bind_callback_env(callback);

    const handle = runAtDate(when, callback);
    return schedule_cleanups().addExposed(() => {
        clearTimeout(handle);
    })
}

function scheduleRecurring(computeNext: () => Date, callback: () => any) {
    let cancelled = false;
    let currentDisposer: () => void;

    const schedule_next = () => {
        if (cancelled) return;

        const nextTime = computeNext();

        if (!nextTime) {
            currentDisposer = null;
            return
        }

        // ctx.logMessage('debug', `Scheduling recurring callback at ${nextTime.toISOString()}`)

        currentDisposer = scheduleTimer(nextTime, async () => {
            await callback();
            schedule_next();
        });
    }

    schedule_next();

    return () => {
        cancelled = true;
        currentDisposer?.();
    }
}

/**
 * Run the given function once after the given amount of time has passed
 */
export function run_in(period: string) {
    const parsed = parse_duration(period);

    const func = (cb) => scheduleTimer(new Date(Date.now() + parsed), cb)

    func.persisted = (action: string) => {
        const sleep_prom = sleep(parsed);
        new ResumableCallbackPromise(sleep_prom, action);
        return () => sleep_prom.cancel();
    }

    return func
}

/**
 * Run the given function once at the given time
 */
export function run_at(time: string) {
    const parsed = _parseTDFormat(time);

    const run_time: Date = parsed().toDate();
    const func = (cb) => scheduleTimer(run_time, cb);

    func.persisted = (action: string) => {
        const sleep_prom = sleep_until(run_time);
        new ResumableCallbackPromise(sleep_prom, action);
        return () => sleep_prom.cancel();
    }

    return func
}

/**
 * Run the given function whenever `period` time has passed
 * 
 * Note that runs will not be exactly `period` apart - the logic waits for the function to complete before scheduling the next run.
 */
export function run_every(period: string) {
    const parsed = parse_duration(period);

    const func = (cb) => {
        return scheduleRecurring(() => new Date(Date.now() + parsed), cb)
    }

    return func;
}
