

import * as babel from "@babel/core";
import * as fs from "fs";
import * as json5 from 'json5';
import * as Module from "module";
import * as VM from "vm2";
import path = require("path");

import { loadTsConfig } from "load-tsconfig";
import { createMatchPath } from 'tsconfig-paths';

import { APP_BABEL_CONFIG } from "../app_transformer";
import { registerSourceMap } from "../app_transformer/source_maps";
import { parseYaml } from "../common/ha_yaml";
import { TD_MODULES_PATH, TYPEDAEMON_PATH, patch } from "../common/util";
import { ApplicationInstance } from "./application_instance";
import { CONSOLE_METHODS, logMessage } from "./logging";
import { patchModule } from "./vm_patches";

type VMExtensions = Record<`.${string}`, (mod: Module, filename: string) => void>;

interface VMInternalResolver {
    checkPath(path: string): boolean;
    pathContext(filename: string, filetype: string): 'host' | 'sandbox'
    resolve(mod: Module, x: string | symbol, options, ext: Record<string, VMExtensions>, direct: boolean): string;
    genLookupPaths(curPath: string): string[];

    loadNodeModules(x: string, dirs: string[], extList: string[]): string;

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

export const PATH_ALIASES = {
    "@td": "@TYPEDAEMON",
    "@td/ha": "@TYPEDAEMON/plugins/home_assistant/api",
    "@td/mqtt": "@TYPEDAEMON/plugins/mqtt/api",
    "@td/http": "@TYPEDAEMON/plugins/http/api",
    "@td/util/*": "@TYPEDAEMON/runtime/util/*",
    "typedaemon/*": "@TYPEDAEMON/*",
}

export const TYPE_ALIASES = {
    ...PATH_ALIASES,
    "mobx": "@SYS_NODE_MODULES/mobx",
    "axios": "@SYS_NODE_MODULES/axios",
}

export async function loadPathMaps(entrypoint: string) {
    const path_maps = {};

    // TODO Allow user to specify additional aliases

    const LOAD_TS_MAPS = false;
    if (LOAD_TS_MAPS) {
        const loadedConfig = loadTsConfig(path.dirname(entrypoint));
        for (let cfg of loadedConfig.files) {
            const data = await fs.promises.readFile(cfg);
            const fl = json5.parse(data.toString());
            const paths: Record<string, string[]> = fl.compilerOptions?.paths || {};
            for (let [p, r] of Object.entries(paths)) {
                if (p == '*') continue;

                path_maps[p] = r.map(m => {
                    if (m.match(/^\.\.?\//)) {
                        m = path.join(path.dirname(cfg), m)
                    }
                    return m;
                })
            }
        }
    }

    for (let [k, v] of Object.entries(PATH_ALIASES)) {
        path_maps[k] = [v.replace("@TYPEDAEMON", TYPEDAEMON_PATH).replace("@SYS_NODE_MODULES", TD_MODULES_PATH)]
    }

    return path_maps;
}

const SYSTEM_MODULES: (string | RegExp)[] = [
    'mobx',
    'typedaemon',
    'axios',
]
const EXTENSIONS = ["js", "ts", "jsx", "tsx"];

function isSystemModule(x: string) {
    let matched = false;
    for (let sm of SYSTEM_MODULES) {
        if (sm instanceof RegExp) {
            if (x.match(sm)) {
                matched = true;
                break;
            };
        } else {
            if (x == sm || x.startsWith(sm + '/')) {
                matched = true;
                break;
            }
        }
    }
    return matched;
}

export function determineModuleContext(filename: string) {
    if (filename.startsWith(TYPEDAEMON_PATH)) {
        let sys_rel = path.relative(TYPEDAEMON_PATH, filename);

        if (!sys_rel.startsWith("node_modules/")) { // In dev, node_modules are a subdir of TD
            if (sys_rel.match(/^(\w+\/)?runtime\/util\//)) {
                return "sandbox";
            }

            return "host";
        }
    }

    if (filename.startsWith(TD_MODULES_PATH)) {
        let sys_rel = path.relative(TD_MODULES_PATH, filename);

        if (isSystemModule(sys_rel)) {
            return "host";
        }
    }

    // TODO If hosted_module, "host"

    return "sandbox";
}

export async function createApplicationVM(app: ApplicationInstance) {
    const consoleMethods: Console = {} as any;
    for (let m of CONSOLE_METHODS) {
        consoleMethods[m] = (...args) => app.logClientMessage(m, ...args)
    }
    consoleMethods["log"] = (...args) => {
        consoleMethods.info(...args)
    }

    const matchPath = createMatchPath(
        path.dirname(app.entrypoint),
        await loadPathMaps(app.entrypoint),
    );

    const opModulesPath = path.join(app.shared_operating_directory, "node_modules");

    const nativeTimers = new Set<any>();
    const nativeIntervals = new Set<any>();
    app.cleanups.append(() => {
        for (let t of nativeTimers) {
            clearTimeout(t);
        }
        for (let t of nativeIntervals) {
            clearInterval(t);
        }
    })

    const vm = new VM.NodeVM({
        sourceExtensions: EXTENSIONS,

        sandbox: {
            setTimeout: (...args) => {
                const timer = setTimeout((...rargs) => {
                    nativeTimers.delete(timer);
                    args[0](...rargs);
                }, args[1])
                nativeTimers.add(timer);
                return timer;
            },
            clearTimeout: (id) => {
                clearTimeout(id);
                nativeTimers.delete(id);
            },
            setInterval: (...args) => {
                const timer = setInterval((...rargs) => {
                    nativeIntervals.delete(timer);
                    args[0](...rargs);
                }, args[1])
                nativeIntervals.add(timer);
                return timer;
            },
            clearInterval: (id) => {
                clearInterval(id);
                nativeIntervals.delete(id);
            },
            console: consoleMethods,
            Symbol: Symbol,
            IS_TYPEDAEMON_VM: true,
        },

        console: 'redirect',

        compiler: (code, filename) => {
            if (filename.includes("node_modules")) return code;

            const result = babel.transformSync(code, {
                ...APP_BABEL_CONFIG,
                filename,
            })

            // TODO Fix memory leak
            registerSourceMap(filename, result.map);

            return result.code;
        },

        require: {
            builtin: ['*'],
            context: "host",
            external: true,
            customRequire(id) {
                logMessage("debug", `Requiring host module '${id}'`)

                let mod = require(id);
                mod = patchModule(id, mod);

                return mod;
            },
            // Fallback Resolver if nothing else works
            resolve(moduleName, parentDirname) {
                return null;
            },
        },
    })

    const vmResolver: VMInternalResolver = vm['_resolver'];

    patch(vmResolver, 'pathContext', original => function (filename, filetype) {
        return determineModuleContext(filename);
    });

    // Can the specified file be loaded by the VM
    patch(vmResolver, 'checkPath', original => function (filename) {
        return true;
    });

    patch(vmResolver, 'resolve', original => function (...args) {
        let [calling_module, requested_module, opts, extension_handlers, direct] = args;

        const mappedPath = matchPath(requested_module as string);
        if (mappedPath) requested_module = mappedPath;

        const resolvedTo: string = original.call(this, calling_module, requested_module, opts, extension_handlers, direct)
        // resolvedTo should be either an absolute path or an internal module. Don't try to watch an internal
        // TODO Watch client node_modules in a better way (eg detect re-installation)
        if (resolvedTo.startsWith('/') && !resolvedTo.includes(TD_MODULES_PATH)) {
            app.markFileDependency(resolvedTo, calling_module.filename);
        }
        logMessage("debug", `Resolved module '${requested_module.toString()}' from ${calling_module.filename} to ${resolvedTo}`);
        return resolvedTo;
    })

    const system_modules_folders = vmResolver.genLookupPaths(TD_MODULES_PATH)

    patch(vmResolver, 'genLookupPaths', original => function (curPath) {
        let paths = original(curPath);

        // Inject the install location of the app's dependencies
        if (!paths.includes(opModulesPath)) paths.unshift(opModulesPath)

        return paths;
    });

    patch(vmResolver, 'loadNodeModules', original => function (x, dirs, extList) {
        // Ensure typedaemon, MobX, etc. will _never_ load from an application's node_modules.
        if (isSystemModule(x)) {
            const resolv = original(x, system_modules_folders, extList);
            if (resolv) return resolv;
            logMessage("warn", `${x} was determined to be a system module, but it could not be found in the system. Falling back to app resolution.`)
        }

        return original(x, dirs, extList);
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

export function requireFromString(src: string, filename: string) {
    const Module = module.constructor;
    // @ts-ignore
    const m = new Module();
    m._compile(src, filename);
    return m.exports;
}
