
import * as fs from "fs";
import * as json5 from 'json5';
import { TsConfigJson } from "type-fest";

import { merger } from "@matchlighter/common_library/data/config"

import { AppConfiguration, AppEntryConfiguration } from "./config_app";
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
        latitude?: number;
        longitude?: number;
        elevation?: number;
        timezone?: string;
    },

    logging?: {
        application?: LogLevel;
        applications_file?: string;

        system?: LogLevel;
        system_file?: string;

        plugins_file?: string;
    };

    /** The dashboard's own HTTP listener (separate from the `http` plugin) */
    dashboard?: {
        /** @default 8099 */
        port?: number;
        /** Opt-in shared secret granting direct access (`Authorization: Bearer` or `?token=`). By default only the HA supervisor ingress proxy is accepted. */
        token?: string;
    };

    sentry?: {
        /** DSN for errors from your applications (failed startups, unhandled errors in app code). App errors are not reported when unset. */
        dsn?: string;
        /** DSN for system errors (TypeDaemon itself, plugins). Unset: TypeDaemon's default; `null` or `''`: don't report system errors. */
        system_dsn?: string | null;
    }

    /**
     * Override parts of the TypeDaemon-default `tsconfig.json` file
     */
    tsconfig?: TsConfigJson;

    path_maps?: Record<string, string[]>;

    /** List of modules that will be imported by the Hypervisor and passed to requiring apps (rather than apps importing their own instance of the module) */
    hosted_modules?: (string | RegExp)[];

    /**
     * Packages to pre-install, specified in `package.json["dependencies"]` format.
     *
     * Installed at startup into `<config root>/node_modules` (via a TD-managed `<config root>/package.json`)
     * and available to every app. Like other app dependencies, they are loaded inside each app's VM, not the host.
     */
    dependencies?: Record<string, string>;

    plugins?: Record<string, PluginConfiguration>,

    apps: Record<string, AppEntryConfiguration>,
}

/** A `Configuration` after the hypervisor has normalized it (app entries have defaults applied and `source` resolved) */
export type NormalizedConfiguration = Omit<Configuration, "apps"> & {
    apps: Record<string, AppConfiguration>;
}

export const defaultConfig: NormalizedConfiguration = {
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
        // system_file: "./logs/%DATE%.log",
    },
    dashboard: {
        port: 8099,
    },
    plugins: {},
    apps: {},
}

export const ConfigMerger = merger<NormalizedConfiguration>({
    daemon: merger({
        watch: merger(),
    }),
    logging: merger(),
    dashboard: merger(),
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
