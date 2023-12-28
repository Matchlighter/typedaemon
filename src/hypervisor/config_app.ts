
import { merger } from "@matchlighter/common_library/data/config"
import { LogLevel } from "./logging";

export interface AppConfiguration {
    source: string;

    human_name?: string;

    /** Only needed if using named, non-default export */
    export?: string;

    /** A unique id for the app. Defaults to the app name */
    uuid?: string;

    operating_directory?: string;

    watch?: {
        config?: boolean;
        source?: boolean;
        // debounce?: number;
    }

    logging?: {
        file?: string;
        level?: LogLevel;
        system_level?: LogLevel;
    }

    dependencies?: any;

    config: any;
}

export const defaultAppConfig: AppConfiguration = {
    source: null,
    export: "default",
    logging: {},
    config: {},
}

export const AppConfigMerger = merger<AppConfiguration>({
    watch: merger(),
    logging: merger({
        
    }, (v) => (typeof v == 'string' ? { file: v } : v)),
})

