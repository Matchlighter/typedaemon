
import { merger } from "@matchlighter/common_library/data/config"
import { LogLevel } from "./logging";

export interface AppConfiguration {
    source: string;

    /** Only needed if using named, non-default export */
    export?: string;

    operating_directory?: string;

    watch?: {
        config?: boolean;
        source?: boolean;
        // debounce?: number;
    }

    logging?: {
        file?: string;
        _thin_app_file?: string;
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

