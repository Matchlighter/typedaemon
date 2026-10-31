import * as fs from "fs";
import type { Hypervisor } from "../hypervisor/hypervisor";
import type { AppConfigSource } from "./app_config_topic";
import { redactConfig } from "./redact_config";
import { configLine, defaultPaths } from "./config_provenance";

/** What the dashboard needs from the hypervisor (public API only) */
export type AppConfigHost = Pick<Hypervisor, 'currentConfig' | 'configFile' | 'rawAppConfig' | 'watchConfigEntry'>;

export function hypervisorAppConfigSource(host: AppConfigHost, readFile: (file: string) => string = f => fs.readFileSync(f, 'utf8')): AppConfigSource {
    return {
        get(id) {
            const config = host.currentConfig.apps?.[id];
            if (!config) return undefined;
            const file = host.configFile;
            let line: number | undefined;
            if (file) {
                try { line = configLine(readFile(file), id) } catch { /* unreadable: no line */ }
            }
            return { config: redactConfig(config), defaults: defaultPaths(config, host.rawAppConfig(id)), file, line };
        },
        // The whole `apps` entry: the app's line moves when another app's entry changes
        onChange: (_id, cb) => host.watchConfigEntry('apps', cb),
    };
}
