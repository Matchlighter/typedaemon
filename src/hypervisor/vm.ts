

import * as VM from "vm2";

export function createUserCodeVM() {
    const vm = new VM.NodeVM({
        require: {
            builtin: ['*'],
            context: "host",
            customRequire: (req) => {
                // TODO If non-system, mark dependency tree and setup watcher
                console.log(req);
                console.log(Object.keys(require.cache))
                return require(req);
            },
            // TODO Will be needed to dynamically compile TS
            // fs: {
            //     resolve: 
            // },
            external: true,
        },
    })

    return vm;
}

export function requireFromString(src: string, filename: string) {
    const Module = module.constructor;
    // @ts-ignore
    const m = new Module();
    m._compile(src, filename);
    return m.exports;
}
