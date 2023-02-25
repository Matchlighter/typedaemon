
import babel = require("@babel/core");
import fs = require("fs");
import md5 = require("md5");
import path = require("path");

import { debounce } from "./limit";

export const TYPEDAEMON_PATH = path.join(__dirname, '..');

// Deep ReadOnly
export type DeepReadonly<T> =
    T extends (infer R)[] ? DeepReadonlyArray<R> :
    T extends Function ? T :
    T extends object ? DeepReadonlyObject<T> :
    T;

export interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> { }

export type DeepReadonlyObject<T> = {
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

export class PromiseTimedout extends Error { }

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
            accept(result);
        }, (err) => {
            clearTimeout(timer);
            reject(err);
        })
    })
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

export function trim(s: string, c: string | RegExp) {
    if (c instanceof RegExp) {
        c = c.source;
    } else {
        if (c === "]") c = "\\]";
        if (c === "^") c = "\\^";
        if (c === "\\") c = "\\\\";
    }
    return s.replace(new RegExp(
        "^(" + c + ")+|(" + c + ")+$", "g"
    ), "");
}
