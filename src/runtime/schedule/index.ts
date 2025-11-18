
import * as cron from "cron-parser";
import * as ne from "nearley";
import parse_duration from "parse-duration";
import * as SunCalc from "suncalc";
import moment from "moment-timezone";

import { current } from "../../hypervisor/current";
import { callback_or_decorator2 } from "../../plugins/util";

import { sleep } from "../sleep";
import { logPluginClientMessage } from "../../hypervisor/logging";
import { bind_callback_env, get_plugin } from "../../plugins/base";
import type { HomeAssistantPlugin } from "../../plugins/home_assistant/plugin";
import { ResumableCallbackPromise } from "../resumable/resumable_method";
import { sleep_until } from "../sleep";

import grammar_cmp from "./schedule2_grammar";

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

interface ScheduleOpts {
    sun?: SunOptions;
    timezone?: string;
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
 * - `{*}/{9-12/2}/{1,15} *:30:00 PM` (Runs half-past each hour on the 1st and 15th of October and December)
 * 
 * Specific weekdays may be specified before the time part:
 * - `MON 4:23:00 PM`
 * - `MON-FRI 4:23:00 PM`
 * - `{*}/{*}/{1-15} MON,TUE 4:23:00 PM` (Runs every Monday and Tuesday during the first half of the month)
 * 
 * A timezone may be suffixed to the time, like so:
 * - `4:23:00 PM America/Denver`
 * - `4:23:00 PM -07:00`
 * 
 * Schedules can also be created relative to sunrise or sunset:
 * - `2023/05/30 sunset+1:00`
 * - `2023/05/30 sunrise-1:00:30`
 * - `sunrise-1:00:30`
 */
export const schedule = callback_or_decorator2((func: SchedulerHandler, sched: Schedule, options?: ScheduleOpts) => {
    options = {
        sun: "ha:default",
        timezone: "ha:default",
        ...options,
    }

    if (typeof sched == "string") {
        if (sched.match(/\d+ ?(h|m|s|d|w)/)) {
            // TODO Is it run_every or run_in? Should it just not be supported here?
            // https://www.npmjs.com/package/parse-duration
            // const parsed = parse_duration(sched);
            throw new Error(`Schedule string is ambiguous. Did you mean to use run_every or run_in?`);
        } else if (isCronValid(sched)) {
            // https://www.npmjs.com/package/cron-parser
            const tz = resolveTimezone({
                // parsed: , // TODO Support cron with TZ appended
                passed: options?.timezone,
            });
            const parsed = cron.parseExpression(sched, { tz });

            return scheduleRecurring(() => {
                parsed.reset(Date.now());
                return parsed.next().toDate();
            }, func)
        } else {
            const get_next = _parseTDFormat(sched, options);

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

function getHAConfig(token: any) {
    if (typeof token == 'string' && token.startsWith('ha:')) {
        let plg_name = token.substring(3);

        const plg = get_plugin(plg_name == "default" ? "home_assistant" : plg_name) as HomeAssistantPlugin;
        if (!plg && plg_name != "default") throw new Error(`Tried to load location info from HA '${plg_name}', but no such plugin exists!`);

        return plg?.ha_config;
    }
    return null;
}

function resolveTimezone(opts: { parsed?: any, passed?: string }) {
    const tdcfg = current.hypervisor?.currentConfig;

    let tz = opts.parsed;

    if (!tz && opts.passed) {
        const hacfg = getHAConfig(opts.passed);
        tz = hacfg ? hacfg.time_zone : opts.passed;
    }

    if (!tz || tz == "td") {
        tz = tdcfg?.location?.timezone;
    }

    if (typeof tz == "object" && "dir" in (tz || {})) {
        return `${tz.dir}${tz.hour.toString().padStart(2, '0')}:${(tz.minute || 0).toString().padStart(2, '0')}`;
    }

    if (!tz) {
        tz = moment.tz.guess();
        // TODO Only log once per app
        logPluginClientMessage("Scheduler", "warn", `Scheduling based on a time, but no timezone set. Guessing ${tz}`);
    }

    return tz;
}

function resolveSunConfig(sun_options: SunOptions): SunConfig {
    const hacfg = getHAConfig(sun_options);
    if (hacfg) {
        sun_options = {
            lat: hacfg.latitude,
            long: hacfg.longitude,
            elev: hacfg.elevation,
        }
    }

    if (sun_options == "td" || !sun_options) {
        const tdcfg = current.hypervisor?.currentConfig;

        sun_options = {
            lat: tdcfg?.location?.latitude,
            long: tdcfg?.location?.longitude,
            elev: tdcfg?.location?.elevation,
        }
    }

    if (!sun_options || typeof sun_options != "object") {
        throw new Error(`Tried to schedule something in relation to the sun, but could not determine location. You need to configure HA or TypeDaemon appropriately.`);
    }

    return sun_options;
}

export const parseTimeOfDay = (sched: string, options?: ScheduleOpts) => {
    // 16:23:00
    // 4:23:00 PM
    // 4:23 PM
    // sunset+4:23:00
    const parsed = _parseTDFormatInternal(sched, options);
    const tz = resolveTimezone({ parsed: null, passed: options?.timezone });
    return parsed.nextAfter(moment().tz(tz).startOf('day').unix() * 1000);
}

export const parseDuration = (dur: string) => {
    return parse_duration(dur);
}

export const _parseTDFormat = (sched: string, options?: ScheduleOpts) => {
    const parsed = _parseTDFormatInternal(sched, options);
    return () => parsed.nextAfter(Date.now());
}

export const _parseTDFormatInternal = (sched: string, options?: ScheduleOpts) => {
    // 2023/05/30 4:23:00 PM
    // 16:23:00
    // 4:23:00 PM
    // 4:23 PM
    // */*/{15,30} 4:23:00 PM
    // */{5-8}/10 4:23:00 PM
    // */{*/3}/10 4:23:00 PM
    // */{*}/10 4:23:00 PM
    // */{*}/10 MON 4:23:00 PM
    // */{*}/10 MON-FRI 4:23:00 PM
    // */{*}/10 MON,THU 4:23:00 PM
    // */{*}/10 MON,THU 4:23:00 PM America/Denver
    // */{*}/10 MON,THU 4:23:00 PM -07:00
    // */{*}/10 sunset+4:23:00

    options ??= {};
    options["sun"] ??= "ha:default";
    options["timezone"] ??= "ha:default";

    const parser = new ne.Parser(grammar);
    parser.feed(sched.toUpperCase());
    const parsed = parser.results[0];

    parsed.date ||= { year: '*', month: '*', day: '*' };
    parsed.day_of_week ||= '*';

    const tz = resolveTimezone({ parsed: parsed.time?.tz, passed: options.timezone });

    // Sun-relative time
    if (parsed.time?.ref) {
        const srel_cron = cron.parseExpression(cronifyBits([
            "59",
            "59",
            "23",
            parsed.date.day,
            parsed.date.month,
            parsed.day_of_week,
            parsed.date.year,
        ]), {
            tz,
        });

        const applySunOffset = (dt: moment.Moment, sunrel: { ref: keyof SunCalc.GetTimesResult, offset: any }) => {
            const mdt = dt.clone().tz(tz);
            const dtStart = mdt.clone().startOf('day');
            const dtEnd = mdt.clone().endOf('day');
            const sun_config = resolveSunConfig(options.sun);

            let chosen: moment.Moment;

            // suncalc is affected by the time-part of the passed Date and I'm not sure how to fix that cleanly
            const dateTrials = [0, -1, 1];
            for (let dto of dateTrials) {
                const mdto = mdt.clone();
                mdto.add(dto, 'days');

                const suntimes = SunCalc.getTimes(mdto.toDate(), sun_config.lat, sun_config.long, sun_config.elev);
                const refdt = suntimes[sunrel.ref.toLowerCase()];
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

        return {
            nextAfter(date: number) {
                srel_cron.reset(date);

                let next_day = toMoment(srel_cron.next());
                next_day = applySunOffset(next_day, parsed.time);

                // Get sun___ on next_day. If past, bump next_day
                if (next_day.isBefore(date)) {
                    next_day = toMoment(srel_cron.next());
                    next_day = applySunOffset(next_day, parsed.time);
                }

                return next_day;
            },
            prevBefore(date: number) {
                srel_cron.reset(date);
                let prev_day = toMoment(srel_cron.prev());
                prev_day = applySunOffset(prev_day, parsed.time);

                // Get sun___ on prev_day. If past, bump prev_day
                if (prev_day.isAfter(date)) {
                    prev_day = toMoment(srel_cron.prev());
                    prev_day = applySunOffset(prev_day, parsed.time);
                }

                return prev_day;
            }
        }

    } else {
        const cron_time = cron.parseExpression(cronifyBits([
            parsed.time.second || '0',
            parsed.time.minute,
            applyMeridian(parsed.time.hour, parsed.time.meridian),
            parsed.date.day,
            parsed.date.month,
            parsed.day_of_week,
            parsed.date.year,
        ]), {
            tz,
            startDate: moment().subtract(5, 'year').toDate(),
            endDate: moment().add(5, 'year').toDate(),
        });

        // TODO In Cron, day-of-month w/ day-of-week is OR. Here, AND is wanted. Need to handle that here.

        return {
            nextAfter(date: number) {
                cron_time.reset(date);
                try {
                    const next_time = cron_time.next();
                    return next_time && toMoment(next_time);
                } catch (e) {
                    return null;
                }
            },
            prevBefore(date: number) {
                cron_time.reset(date);
                try {
                    const prev_time = cron_time.prev();
                    return prev_time && toMoment(prev_time);
                } catch (e) {
                    return null;
                }
            }
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
    if (hour == 12) hour = 0;
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
export function run_at(time: string, options?: ScheduleOpts) {
    const parsed = _parseTDFormat(time, options);

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
