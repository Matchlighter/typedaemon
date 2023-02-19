
import * as fs from "fs";
import * as yaml from "js-yaml";

import { merger } from "@matchlighter/common_library/cjs/data/config"

import { AppConfiguration } from "./config_app";
import { convertTypescript } from "../common/util";
import { HA_YAML_SCHEMA } from "../common/ha_yaml";
import { requireFromString } from "./vm";

export interface Configuration {
    daemon?: {
        watch?: {
            config?: boolean;
            app_configs?: boolean;
            app_source?: boolean;
        }
    },
    plugins?: [],
    apps: Record<string, AppConfiguration>,
}

export const defaultConfig: Configuration = {
    daemon: {
        watch: {
            config: true,
            app_configs: true,
            app_source: true,
        }
    },
    apps: {},
}

export const ConfigMerger = merger<Configuration>({
    daemon: merger({
        watch: merger(),
    }),
})

export const readConfigFile = async (file: string) => {
    let csrc = (await fs.promises.readFile(file)).toString();

    if (file.match(/\.ts$/)) {
        csrc = await convertTypescript(csrc, file);
    }

    if (file.match(/\.[jt]s$/)) {
        const loadedModule = requireFromString(csrc, file);
        const data = loadedModule.default || loadedModule;

        if (typeof data == 'function') {
            return await data();
        } else {
            return data;
        }
    }

    if (file.match(/\.json$/)) {
        return JSON.parse(csrc);
    }

    if (file.match(/\.ya?ml$/)) {
        return yaml.load(csrc, {
            schema: HA_YAML_SCHEMA,
        });
    }

    throw new Error("Unkown config file type");
}
