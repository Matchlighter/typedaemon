
import { TupleToUnion } from "type-fest";
import chalk = require("chalk");
import winston = require("winston");
import moment = require("moment-timezone");

import { current } from "./current";
import { pojso } from "../common/util";
import { mapStackTrace } from "../app_transformer/source_maps";

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

export function colorLogLevel(level: ConsoleMethod | string) {
    const nlevel = level.toLowerCase();
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
    let { level, message, label } = m;
    level = level.toUpperCase();
    return chalk`[${label}] - ${colorLogLevel(level)} - ${message}`;
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
    domain?: string;
    level?: LogLevel;
    file?: string;
}

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
        transports.push(...[
            // new winston.transports.File({
            //     filename: 'error.log',
            //     level: 'error',
            //     format: fmt.combine(
            //         timed_formatter,
            //         fmt.uncolorize({}),
            //     ),
            // }),
            new winston.transports.File({
                filename: opts.file,
                format: fmt.combine(
                    timed_formatter,
                    fmt.uncolorize({}),
                ),
            }),
        ]);
    }

    const logger = winston.createLogger({
        level: opts.level,
        levels: NUMERIC_LOG_LEVELS,
        format: fmt.combine(
            timestamp(),
            scope_fmt(),
            fmt.label({ label: opts.domain || 'System' }),
            filter(),
        ),
        defaultMeta: { service: 'user-service' },
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
            if (b instanceof Error) {
                const cleanTrace = cleanAndMapStacktrace(b);
                return cleanTrace?.join('\n') || b.message;
            };
            if (typeof b == 'object' && pojso(b)) return JSON.stringify(b);
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

    return logger;
}

export function logMessage(level: LogLevel, ...rest: any[]) {
    const ctx = current.application || current.hypervisor;
    const logger = ctx?.logger || UKNOWN_LOGGER
    logger.logMessage(level, rest);
}

const UKNOWN_LOGGER = createDomainLogger({ domain: chalk.yellow("???") });
for (let cm of CONSOLE_METHODS) {
    console[cm] = (m, ...rest) => {
        const ctx = current.application || current.hypervisor;
        const logger = ctx?.logger || UKNOWN_LOGGER
        logger.log(cm, m, ...rest);
    }
}
