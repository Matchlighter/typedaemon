
import fs = require("fs")
import path = require("path");
import { TsConfigJson } from "type-fest";
import fse = require('fs-extra');

import { merger } from "@matchlighter/common_library/data/config";
import { Hypervisor } from "../hypervisor/hypervisor";
import { TD_DEVELOPER_MODE, TYPEDAEMON_PATH } from "./util";
import { Configuration } from "../hypervisor/config";
import { PATH_ALIASES } from "../hypervisor/vm";

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
    const typedaemon_dir = TD_DEVELOPER_MODE ? path.relative(hv.operations_directory, TYPEDAEMON_PATH) : "./node_modules/typedaemon";
    const cfg = hv.currentConfig as Configuration;

    const paths = {}

    for (let [k, v] of Object.entries(PATH_ALIASES)) {
        paths[k] = [v.replace("@TYPEDAEMON", typedaemon_dir)]
    }

    Object.assign(paths, {
        "*": ["./node_modules/*"],
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
            ],
            "module": "CommonJS",
            "moduleResolution": "node",
            "sourceMap": true,
            "target": "ES2018",
            "esModuleInterop": true,
            "resolveJsonModule": true,
            "paths": paths,
        }
    }
    tscfg = tsconfigMerger.mergeConfigs(tscfg, { compilerOptions: { paths: cfg.path_maps || {} } }, cfg.tsconfig || {});
    await fse.mkdirp(hv.operations_directory);
    await fs.promises.writeFile(path.join(hv.operations_directory, "gen.tsconfig.json"), JSON.stringify(tscfg, null, 4));
}
