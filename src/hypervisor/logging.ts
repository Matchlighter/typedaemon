
import { TupleToUnion } from "type-fest";
import chalk = require("chalk");
import winston = require("winston");

import { current } from "./current";
import { pojso } from "../common/util";

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

const fmt = winston.format;

function formatMessage(m: winston.Logform.TransformableInfo) {
    let { level, message, label } = m;
    level = level.toUpperCase();
    return chalk`[${label}] - ${colorLogLevel(level)} - ${message}`;
}

const formatter = fmt.printf(formatMessage)

const timed_formatter = fmt.printf((m) => {
    const { message, level, label, timestamp, ...rest } = m;
    // ORIGINAL_CONSOLE.log(m);
    return chalk`[${timestamp}]` + formatMessage(m);
})

const scope_fmt = fmt((info) => {
    info['scope'] ||= "typedaemon";
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
            fmt.timestamp(),
            scope_fmt(),
            fmt.label({ label: opts.domain || 'System' }),
            filter(),
        ),
        defaultMeta: { service: 'user-service' },
        transports,
    }) as any as ExtendedLoger;

    logger.logMessage = (level, message, meta?: any) => {
        message = message.map(b => {
            if (typeof b == 'object' && pojso(b)) return JSON.stringify(b);
            return String(b);
        })
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
