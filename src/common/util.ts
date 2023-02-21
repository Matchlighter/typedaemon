
import * as babel from "@babel/core";
import * as chalk from "chalk";
import * as fs from "fs";
import * as md5 from "md5";

import { ConsoleMethod } from "../hypervisor/vm";
import { debounce } from "./limit";

// Deep ReadOnly
export type DeepReadonly<T> =
    T extends (infer R)[] ? DeepReadonlyArray<R> :
    T extends Function ? T :
    T extends object ? DeepReadonlyObject<T> :
    T;

interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> { }

type DeepReadonlyObject<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export type TupleToUnion<T extends Readonly<any[]>> = T[number];

export const convertTypescript = async (source: string, filename: string) => {
    const BABEL_CONFIG: babel.TransformOptions = {
        targets: {
            esmodules: true,
            node: "current",
        },
        presets: [
            ['@babel/preset-env', { targets: { node: 'current' }, modules: 'auto' }],
            ['@babel/preset-typescript'],
        ],
    }
    const result = await babel.transformAsync(source, {
        filename,
        ...BABEL_CONFIG,
    });
    return result.code
}

export function pojso(pbj: any) {
    // TODO
    return true;
}

export class PromiseTimedout extends Error {}

export function timeoutPromise<T>(timeout: number, promise: Promise<T>, timeoutAction?: () => void): Promise<T> {
    return new Promise((accept, reject) => {
        const timer = setTimeout(() => {
            if (timeoutAction) {
                Promise.resolve(timeoutAction()).then((r) => {
                    accept(r as any)
                });
            } else {
                reject(new PromiseTimedout());
            }
        }, timeout);

        promise.then((result) => {
            clearTimeout(timer);
            accept(result)
        })
    })
}

export function colorLogLevel(level: ConsoleMethod | string) {
    if (level == "error") return chalk.red(level);
    if (level == "warn") return chalk.yellow(level);
    return level;
}

export const watchFile = (file: string, callback: (file: string) => void, config: { throttle: number } = { throttle: 3000 }) => {
    let md5Previous = null;

    const throttled_callback = debounce({ timeToStability: 100, maxTime: config.throttle }, async (_file: string) => {
        const md5Current = md5(await fs.promises.readFile(file));
        if (md5Current === md5Previous) return;
        md5Previous = md5Current;

        await callback(file);
    })

    return fs.watch(file, throttled_callback);
}

export const fileExists = async (file: string) => {
    try {
        const stat = await fs.promises.stat(file);
        return !!stat;
    } catch {
        return false;
    }
}
