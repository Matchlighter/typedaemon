
import * as path from "path";
import { TupleToUnion } from "type-fest";
import { inspect } from 'util';
import chalk = require("chalk");
import winston = require("winston");
import moment = require("moment-timezone");

require('winston-daily-rotate-file');

import { mapStackTrace } from "../app_transformer/source_maps";
import { pojso } from "../common/util";
import { cacheOn } from "../util";
import { current } from "./current";
import { HyperWrapper } from "./managed_apps";
import { PluginInstance } from "./plugin_instance";

export const CONSOLE_METHODS = ['debug', 'info', 'warn', 'error', 'dir'] as const;
export type ConsoleMethod = TupleToUnion<typeof CONSOLE_METHODS>
export type LogLevel = ConsoleMethod | 'lifecycle'

const NUMERIC_LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6,

    lifecycle: 1,
}

export const ORIGINAL_CONSOLE = { ...console };

export function colorLogLevel(level: ConsoleMethod | string, clevel = level) {
    const nlevel = clevel.toLowerCase();
    if (nlevel == "error") return chalk.red(level);
    if (nlevel == "warn") return chalk.yellow(level);
    if (nlevel == "info") return chalk.blue(level);
    if (nlevel == "log") return chalk.blue(level);
    if (nlevel == "debug") return chalk.gray(level);
    if (nlevel == "lifecycle") return chalk.green(level);
    return level;
}

export function cleanAndMapStacktrace(err: Error) {
    const trace = err.stack || '';
    const stack = trace.split("\n");

    if (trace.startsWith('SyntaxError:')) {
        return stack.filter(line => {
            return !/^\s+at/.test(line);
        })
    }

    const working_directory = current.hypervisor?.working_directory || '';
    const clean_stack = [];

    let found = false;
    for (let line of [...stack].reverse()) {
        found ||= line.includes(working_directory);
        if (!found) continue;
        clean_stack.unshift(line);
    }

    const mapped = mapStackTrace(clean_stack);
    if (mapped) return mapped;

    return clean_stack;
}

const fmt = winston.format;

function formatMessage(m: winston.Logform.TransformableInfo) {
    let { level, message, label, level_prefix, label_format } = m;
    label = (label_format as string || "[%MSG%]").replace('%MSG%', label);
    let flevel = (level_prefix || '') + level;
    flevel = flevel.toUpperCase();
    return chalk`${label} - ${colorLogLevel(flevel, level)} - ${message}`;
}

const formatter = fmt.printf(formatMessage)

const timed_formatter = fmt.printf((m) => {
    const { message, level, label, timestamp, ...rest } = m;
    return chalk`[${timestamp}]` + formatMessage(m);
})

const scope_fmt = fmt((info) => {
    info['scope'] ||= "typedaemon";
    return info;
})

const timestamp = fmt((info) => {
    info['timestamp'] ||= moment().toISOString(true);
    return info;
})

const filter = fmt((info) => {
    if (info.scope == 'typedaemon') {

    }
    return info;
})

export interface LoggerOptions {
    level_prefix?: string;
    label_format?: string;
    domain?: string;
    level?: LogLevel;
    file?: string;
    transport_cache?: any;
}

export type Logger = winston.Logger;

export interface ExtendedLoger extends winston.Logger {
    logMessage: (level: LogLevel, message: any[], meta?: any) => void;
}

export function createDomainLogger(opts: LoggerOptions) {
    const transports: winston.transport[] = [
        new winston.transports.Console({
            format: formatter
        }),
    ]

    if (opts.file) {
        let filename = opts.file;
        if (!filename.includes("%DATE%")) {
            const hasExt = filename.match(/\.\w+$/);
            if (!filename.endsWith('/')) filename += ".";
            filename += "%DATE%"
            if (!hasExt) filename += ".log";
        }

        const file_transport = cacheOn(opts.transport_cache, filename, () => new (winston.transports as any).DailyRotateFile({
            filename,
            auditFile: path.join(path.dirname(filename), ".log_audit.json"),
            datePattern: 'YYYY-MM-DD',
            // zippedArchive: true,
            maxSize: '1m',
            maxFiles: '14',
            format: fmt.combine(
                timed_formatter,
                fmt.uncolorize({}),
            ),
        }));

        transports.push(file_transport);
    }

    const logger = winston.createLogger({
        level: opts.level,
        levels: NUMERIC_LOG_LEVELS,
        exitOnError: false,
        format: fmt.combine(
            timestamp(),
            scope_fmt(),
            fmt.label({ label: opts.domain || 'System' }),
            filter(),
        ),
        defaultMeta: {
            service: 'user-service',
            level_prefix: opts.level_prefix,
            label_format: opts.label_format,
        },
        transports,
    }) as any as ExtendedLoger;

    let lastMessageTimeout;
    let lastMessage: { level: LogLevel, meta: any, message: string, count: number };

    const commitLastMessageCounter = () => {
        const lm = lastMessage;
        if (lm?.count > 0) {
            logger.log(lm.level, `Same message logged ${lm.count} more times`, lm.meta);
        }
        if (lastMessageTimeout) clearTimeout(lastMessageTimeout);
        lastMessage = null;
        lastMessageTimeout = null;
    }

    logger.logMessage = (level, message, meta?: any) => {
        message = message.map(b => {
            if (b instanceof Error || b?.stack) {
                const cleanTrace = cleanAndMapStacktrace(b);
                return cleanTrace?.join('\n') || b.message;
            };
            if (typeof b == 'object' && pojso(b)) return inspect(b);
            return String(b);
        })

        const lmessage = message.join(' ');
        if (lastMessage?.message == lmessage) {
            lastMessage.count++;
            if (!lastMessageTimeout) {
                lastMessageTimeout = setTimeout(commitLastMessageCounter, 750);
            }
            return;
        } else {
            commitLastMessageCounter();
            lastMessage = { level, message: lmessage, meta, count: 0 }
        }

        return logger.log(level, message.join(' '), meta);
    }

    logger.on("finish", () => ORIGINAL_CONSOLE.log("END", opts.file))

    return logger;
}

export type LogAMessage = typeof logMessage;

export function logClientMessage(level: LogLevel, ...rest: any[]) {
    const ctx = current.application;
    const logger = ctx?.userSpaceLogger || UNKNOWN_LOGGER
    logger.logMessage(level, rest);
}

export function logPluginClientMessage(plugin: any, level: LogLevel, ...rest: any[]) {
    if (!(plugin instanceof PluginInstance)) plugin = plugin[HyperWrapper];

    const ctx = current.application;
    const logger = ctx?.logger || UNKNOWN_LOGGER
    logger.logMessage(level, ["[" + chalk.blueBright`${plugin.id}` + "]", ...rest], {});
}

export function logMessage(level: LogLevel, ...rest: any[]) {
    const ctx = current.application || current.hypervisor;
    const logger = ctx?.logger || UNKNOWN_LOGGER
    logger.logMessage(level, rest);
}

export function logHVMessage(level: LogLevel, ...rest: any[]) {
    const ctx = current.hypervisor;
    const logger = ctx?.logger || UNKNOWN_LOGGER
    logger.logMessage(level, rest);
}

export let UNKNOWN_LOGGER = createDomainLogger({ domain: chalk.yellow("???") });
export function setFallbackLogger(logger: ExtendedLoger) {
    UNKNOWN_LOGGER = logger;
}

export function redirectConsole() {
    for (let cm of CONSOLE_METHODS) {
        console[cm] = (m, ...rest) => {
            const ctx = current.application || current.hypervisor;
            const logger = ctx?.logger || UNKNOWN_LOGGER
            try {
                logger.logMessage(cm, [m, ...rest]);
            } catch (ex) {
                ORIGINAL_CONSOLE.error(ex)
            }
        }
    }
    console.log = (...rest) => console.info(...rest);
}
