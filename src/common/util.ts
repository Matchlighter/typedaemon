
import babel = require("@babel/core");
import fs = require("fs");
import md5 = require("md5");
import path = require("path");

import { debounce } from "@matchlighter/common_library/limit";

export const __package_dir = path.join(__dirname, '../../');
export const TYPEDAEMON_PATH = path.join(__dirname, '..');
export const TD_DEVELOPER_MODE = process.env['TYPEDAEMON_ENV'] != 'production' && !TYPEDAEMON_PATH.includes("node_modules");

export const TD_MODULES_PATH = TD_DEVELOPER_MODE ? path.join(__package_dir, 'node_modules') : path.join(__package_dir, '..');

const TD_PACKAGE_JSON = require(path.join(__package_dir, "package.json"));

export const TD_VERSION = TD_PACKAGE_JSON.version;

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

const plainObjectString = Object.toString()

export function pojso(value: any) {
    if (value == null) return true;

    const proto = Object.getPrototypeOf(value)
    if (proto == null) return true;

    const protoConstructor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor
    return (
        typeof protoConstructor === "function" && protoConstructor.toString() === plainObjectString
    )
}

export function deep_pojso(value: any) {
    const proto = Object.getPrototypeOf(value)
    if (typeof value == "function") return false;
    if ((typeof value == "object" && !Array.isArray(value)) && proto != null) return false;

    for (let [k, v] of Object.entries(value)) {
        if (typeof v == 'object' && !deep_pojso(v)) return false;
    }

    return true;
}

export function serializable(value: any, serializer_keys: (string | symbol | ((v: any) => boolean))[]) {
    function has_key(obj: any) {
        for (let k of serializer_keys) {
            if (typeof k == "function") {
                if (k(obj)) return true;
            } else {
                if (value[k]) return true;
            }
        }
        return false;
    }

    if (Array.isArray(value)) {
        for (let av of value) {
            if (!serializable(av, serializer_keys)) return false;
        }
        return true;
    }

    if (typeof value == "object") {
        const proto = Object.getPrototypeOf(value);
        if (proto) {
            return has_key(value);
        } else {
            for (let [k, v] of Object.entries(value)) {
                if (!serializable(v, serializer_keys)) return false;
            }
            return true;
        }
    }

    if (typeof value == "function") {
        return has_key(value);
    }

    // Primitive
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

export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export function trim(s: string, c: string | RegExp) {
    if (c instanceof RegExp) {
        c = c.source;
    } else {
        c = escapeRegExp(c);
    }
    return s.replace(new RegExp(
        "^(" + c + ")+|(" + c + ")+$", "g"
    ), "");
}

class Resolver {
    async loadAsFileOrDirectory(x, extList) {
        const f = await this.loadAsFile(x, extList);
        if (f) return f;
        return await this.loadIndex(x, extList);
    }

    async tryFile(x) {
        x = path.resolve(x);
        return await this.pathTestIsFile(x) && x;
    }

    async tryWithExtension(x, extList) {
        for (let i = 0; i < extList.length; i++) {
            const ext = extList[i];
            if (ext !== path.basename(ext)) continue;
            const f = await this.tryFile(x + ext);
            if (f) return f;
        }
        return undefined;
    }

    // LOAD_AS_FILE(X)
    async loadAsFile(x, extList) {
        // 1. If X is a file, load X as its file extension format. STOP
        const f = await this.tryFile(x);
        if (f) return f;
        // 2. If X.js is a file, load X.js as JavaScript text. STOP
        // 3. If X.json is a file, parse X.json to a JavaScript Object. STOP
        // 4. If X.node is a file, load X.node as binary addon. STOP
        return await this.tryWithExtension(x, extList);
    }

    // LOAD_INDEX(X)
    async loadIndex(x, extList) {
        // 1. If X/index.js is a file, load X/index.js as JavaScript text. STOP
        // 2. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
        // 3. If X/index.node is a file, load X/index.node as binary addon. STOP
        return await this.tryWithExtension(path.join(x, 'index'), extList);
    }

    async pathTestIsDirectory(path) {
        try {
            const stat = await fs.promises.stat(path);
            return stat && stat.isDirectory();
        } catch (e) {
            return false;
        }
    }

    async pathTestIsFile(path) {
        try {
            const stat = await fs.promises.stat(path);
            return stat && stat.isFile();
        } catch (e) {
            return false;
        }
    }
}

export async function resolveSourceFile(fpath: string) {
    return await (new Resolver).loadAsFileOrDirectory(fpath, [".ts", ".js"])
}

export async function* walk(dir, should_recurse: (path: string) => boolean = () => true): AsyncGenerator<string> {
    for await (const dname of await fs.promises.readdir(dir)) {
        const entry = path.join(dir, dname);
        const stat = await fs.promises.stat(entry)
        if (stat.isDirectory() && should_recurse(entry)) yield* walk(entry, should_recurse);
        else if (stat.isFile()) yield entry;
    }
}

export async function* walk_files(dir, types: string[]) {
    const filter = (dirname: string) => !dirname.match(/(node_modules)\/?$/)
    for await (const file of walk(dir, filter)) {
        if (types.includes(path.extname(file).slice(1))) yield file;
    }
}

export function patch<T, K extends keyof T>(target: T, key: K, patcher: (original: T[K]) => T[K]) {
    const original: any = target[key];
    target[key] = function (...args) {
        const caller = ((...args) => original.call(this, ...args)) as T[K];
        return (patcher(caller) as any).call(this, ...args);
    } as any;
}

import { eachLine } from "line-reader";

export function read_lines(file: string, options: LineReaderOptions, iteratee: (line: string, last: boolean) => void) {
    return new Promise((resolve, reject) => {
        eachLine(file, options, iteratee, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(null);
            }
        })
    })
}

export function split_once(str: string, splitter: string) {
    const i = str.indexOf(splitter);
    return [str.slice(0, i), str.slice(i + 1)];
}
