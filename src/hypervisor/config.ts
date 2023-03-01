
import * as fs from "fs";
import * as json5 from 'json5';
import { TsConfigJson } from "type-fest";

import { merger } from "@matchlighter/common_library/cjs/data/config"

import { AppConfiguration } from "./config_app";
import { convertTypescript } from "../common/util";
import { parseYaml } from "../common/ha_yaml";
import { requireFromString } from "./vm";
import { PluginConfiguration } from "./config_plugin";
import { LogLevel } from "./logging";

export interface Configuration {
    daemon?: {
        watch?: {
            config?: boolean;
            app_configs?: boolean;
            app_source?: boolean;
            // app_debounce?: number;
        },
    },

    location?: {
        timezone?: string;
    },

    logging?: {
        application?: LogLevel;
        applications_file?: string;

        plugins_file?: string;

        system?: LogLevel;
        system_file?: string;
    };

    /**
     * Override parts of the TypeDaemon-default `tsconfig.json` file
     */
    tsconfig?: TsConfigJson;

    path_maps?: Record<string, string[]>;

    /** List of modules that will be imported by the Hypervisor and passed to requiring apps (rather than apps importing their own instance of the module) */
    hosted_modules?: (string | RegExp)[];

    /**
     * Additional packages that should be installed, specified in `package.json["dependencies"]` format.
     * 
     * These packages are automatically added to `hosted_modules`
     */
    dependencies?: any;

    plugins?: Record<string, PluginConfiguration>,

    apps: Record<string, AppConfiguration>,
}

export const defaultConfig: Configuration = {
    daemon: {
        watch: {
            config: true,
            app_configs: true,
            app_source: true,
            // app_debounce: 2000,
        }
    },
    logging: {
        application: "info",
        // applications_file: "{app}.log",
        system: "warn",
        system_file: "./logs/typedaemon.log",
    },
    plugins: {},
    apps: {},
}

export const ConfigMerger = merger<Configuration>({
    daemon: merger({
        watch: merger(),
    }),
    logging: merger(),
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
        return json5.parse(csrc);
    }

    if (file.match(/\.ya?ml$/)) {
        return parseYaml(csrc, { filename: file });
    }

    throw new Error("Unkown config file type");
}
