
import fs = require("fs")
import path = require("path");
import { TsConfigJson } from "type-fest";
import fse = require('fs-extra');

import { merger } from "@matchlighter/common_library/data/config";
import { Configuration } from "../hypervisor/config";
import { Hypervisor } from "../hypervisor/hypervisor";
import { TYPE_ALIASES } from "../hypervisor/vm";
import { TD_DEVELOPER_MODE, TYPEDAEMON_PATH } from "./util";

const tsconfigMerger = merger<TsConfigJson>({
    compilerOptions: merger({
        paths: (upper, lower) => {
            const mrg = { ...upper }
            for (let [k, v] of Object.entries(lower)) {
                if (v[0] == '!') {
                    mrg[k] = v.slice(1);
                } else {
                    mrg[k] = [...v, ...upper[k] || []];
                }
            }
            return mrg;
        },
    }),
})

export async function saveGeneratedTsconfig(hv: Hypervisor) {
    const typedaemon_dir = TD_DEVELOPER_MODE ? path.relative(hv.operations_directory, TYPEDAEMON_PATH) : "./node_modules/typedaemon/dist";
    const cfg = hv.currentConfig as Configuration;

    const paths = {}

    for (let [k, v] of Object.entries(TYPE_ALIASES)) {
        paths[k] = [v.replace("@TYPEDAEMON", typedaemon_dir).replace("@SYS_NODE_MODULES", "./node_modules")]
    }

    Object.assign(paths, {
        // "*": ["./node_modules/*"],
    })

    let tscfg: TsConfigJson = {
        compilerOptions: {
            "allowSyntheticDefaultImports": false,
            "lib": [
                "es6",
                "dom",
                "es2017",
                "ES2020",
                "ESNext",
                "ES2022",
                "esnext.decorators",
            ] as any,
            "module": "Node16",
            // @ts-ignore
            "moduleResolution": "Bundler",
            "sourceMap": true,
            "target": "ES2022",
            "esModuleInterop": true,
            "resolveJsonModule": true,
            "paths": paths,
        }
    }
    tscfg = tsconfigMerger.mergeConfigs(tscfg, { compilerOptions: { paths: cfg.path_maps || {} } }, cfg.tsconfig || {});
    await fse.mkdirp(hv.operations_directory);
    await fs.promises.writeFile(path.join(hv.operations_directory, "gen.tsconfig.json"), JSON.stringify(tscfg, null, 4));
}
