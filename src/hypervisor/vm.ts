

import * as Module from "module";
import * as fs from "fs";
import * as VM from "vm2";
import * as babel from "@babel/core"

import { parseYaml } from "../common/ha_yaml";
import { ApplicationInstance } from "./application";
import { TupleToUnion } from "../common/util";
import { APP_BABEL_CONFIG } from "../app_transformer";

type VMExtensions = Record<`.${string}`, (mod: Module, filename: string) => void>;

interface VMInternalResolver {
    checkPath
    pathContext(filename: string, filetype: string): 'host' | 'sandbox'
    customResolver
    compiler
    strict
    packageCache: any;
    scriptCache: any;

    resolve(mod: Module, x: string | symbol, options, ext: Record<string, VMExtensions>, direct: boolean): string;
}

interface VMModule {
    _extensions: VMExtensions;
}

const CONSOLE_METHODS = ['debug', 'log', 'info', 'warn', 'error', 'dir'] as const;
export type ConsoleMethod = TupleToUnion<typeof CONSOLE_METHODS>

export function createApplicationVM(app: ApplicationInstance) {
    const consoleMethods = {};
    for (let m of CONSOLE_METHODS) {
        consoleMethods[m] = (...args) => app.logMessage(m, ...args)
    }

    const vm = new VM.NodeVM({
        sourceExtensions: ["js", "ts"],

        // TODO Disable/fix core scheduling and events (eg setTimeout)
        //   Provide a proxy to access similar features
        sandbox: {
            setTimeout: null,
            setInterval: null,
            clearInterval: null,
            clearTimeout: null,
            console: consoleMethods,
        },

        console: 'redirect',

        compiler: (code, filename) => {
            const result = babel.transformSync(code, {
                ...APP_BABEL_CONFIG,
                filename,
            })
            return result.code;
        },

        require: {
            builtin: ['*'],
            context: "host",
            external: true,
        },
    })

    const vmResolver: VMInternalResolver = vm['_resolver'];

    patch(vmResolver, 'pathContext', original => function (filename, filetype) {
        return app.includedFileScope(filename);
    });

    patch(vmResolver, 'resolve', original => function (...args) {
        const [calling_module, reuested_module, opts, extension_handlers, direct] = args;
        const resolvedTo: string = original.call(this, ...args)
        app.markFileDependency(resolvedTo, calling_module.filename);
        // console.log("Resolved", reuested_module, "from", calling_module.filename, "to", resolvedTo)
        return resolvedTo;
    })

    const vmModule: VMModule = vm['_Module'];
    vmModule._extensions[".yml"] = (mod, filename) => {
        const yaml = fs.readFileSync(filename).toString();
        const parsed = parseYaml(yaml, { filename })
        mod.exports = parsed;
    }

    return vm;
}

function patch<T, K extends keyof T>(target: T, key: K, patcher: (original: T[K]) => T[K]) {
    const original = target[key];
    target[key] = patcher(original);
}

export function requireFromString(src: string, filename: string) {
    const Module = module.constructor;
    // @ts-ignore
    const m = new Module();
    m._compile(src, filename);
    return m.exports;
}
