

import * as Module from "module";
import * as fs from "fs";
import * as VM from "vm2";
import * as babel from "@babel/core"
import * as json5 from 'json5';
import path = require("path");

import { createMatchPath } from 'tsconfig-paths';
import { loadTsConfig } from "load-tsconfig"

import { parseYaml } from "../common/ha_yaml";
import { ApplicationInstance } from "./application_instance";
import { TupleToUnion } from "../common/util";
import { APP_BABEL_CONFIG } from "../app_transformer";

type VMExtensions = Record<`.${string}`, (mod: Module, filename: string) => void>;

interface VMInternalResolver {
    checkPath(path: string): boolean;
    pathContext(filename: string, filetype: string): 'host' | 'sandbox'
    resolve(mod: Module, x: string | symbol, options, ext: Record<string, VMExtensions>, direct: boolean): string;
    genLookupPaths(curPath: string): string[];

    customResolver
    compiler
    strict
    packageCache: any;
    scriptCache: any;
}

interface VMModule {
    _extensions: VMExtensions;
    globalPaths: string[];
}

const CONSOLE_METHODS = ['debug', 'log', 'info', 'warn', 'error', 'dir'] as const;
export type ConsoleMethod = TupleToUnion<typeof CONSOLE_METHODS>

export async function createApplicationVM(app: ApplicationInstance) {
    const consoleMethods = {};
    for (let m of CONSOLE_METHODS) {
        consoleMethods[m] = (...args) => app.logMessage(m, ...args)
    }

    const loadedConfig = loadTsConfig(path.dirname(app.entrypoint));
    const loadedPathMaps = {};
    for (let cfg of loadedConfig.files) {
        const data = await fs.promises.readFile(cfg);
        const fl = json5.parse(data.toString());
        const paths: Record<string, string[]> = fl.compilerOptions?.paths || {};
        for (let [p, r] of Object.entries(paths)) {
            loadedPathMaps[p] = r.map(m => {
                if (m.startsWith('./')) {
                    m = path.join(path.dirname(cfg), m)
                }
                return m;
            })
        }
    }

    const matchPath = createMatchPath(
        path.dirname(app.entrypoint),
        loadedPathMaps,
    );

    const EXTENSIONS = ["js", "ts", "jsx", "tsx"]

    const vm = new VM.NodeVM({
        sourceExtensions: EXTENSIONS,

        // TODO Disable/fix core scheduling and events (eg setTimeout)
        //   Provide a proxy to access similar features
        sandbox: {
            setTimeout: null,
            setInterval: null,
            clearInterval: null,
            clearTimeout: null,
            console: consoleMethods,
            IS_TYPEDAEMON_VM: true,
        },

        console: 'redirect',

        compiler: (code, filename) => {
            if (filename.includes("node_modules")) return code;

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
            // Fallback Resolver if nothing else works
            resolve(moduleName, parentDirname) {
                return null;
            },
        },
    })

    const vmResolver: VMInternalResolver = vm['_resolver'];

    patch(vmResolver, 'pathContext', original => function (filename, filetype) {
        return app.includedFileScope(filename);
    });

    // Can the specified file be loaded by the VM
    patch(vmResolver, 'checkPath', original => function (filename) {
        return true;
    });

    patch(vmResolver, 'resolve', original => function (...args) {
        let [calling_module, requested_module, opts, extension_handlers, direct] = args;

        const tsMappedPath = matchPath(requested_module as string);
        if (tsMappedPath) requested_module = tsMappedPath;

        const resolvedTo: string = original.call(this, calling_module, requested_module, opts, extension_handlers, direct)
        app.markFileDependency(resolvedTo, calling_module.filename);
        // console.log("Resolved", reuested_module, "from", calling_module.filename, "to", resolvedTo)
        return resolvedTo;
    })

    patch(vmResolver, 'genLookupPaths', original => function (curPath) {
        const paths = original(curPath);
        const opModulesPath = path.join(app.operating_directory, "node_modules");

        // Inject the install location of the app's dependencies
        if (!paths.includes(opModulesPath)) paths.unshift(opModulesPath)

        return paths;
    });

    const vmModule: VMModule = vm['_Module'];
    vmModule._extensions[".yml"] = vmModule._extensions[".yaml"] = (mod, filename) => {
        const yaml = fs.readFileSync(filename).toString();
        const parsed = parseYaml(yaml, { filename })
        mod.exports = parsed;
    }
    vmModule._extensions[".json"] = (mod, filename) => {
        const raw = fs.readFileSync(filename).toString();
        const parsed = json5.parse(raw);
        mod.exports = parsed;
    }

    return vm;
}

function patch<T, K extends keyof T>(target: T, key: K, patcher: (original: T[K]) => T[K]) {
    const original: any = target[key];
    // V1 Simpler, but requires patched func to use `original.call(this, ...)`
    // target[key] = patcher(original);

    // V2 Handles passing `this`
    target[key] = function (...args) {
        const caller = ((...args) => original.call(this, ...args)) as T[K];
        return (patcher(caller) as any).call(this, ...args);
    } as any;
}

export function requireFromString(src: string, filename: string) {
    const Module = module.constructor;
    // @ts-ignore
    const m = new Module();
    m._compile(src, filename);
    return m.exports;
}
