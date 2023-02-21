
import { merger } from "@matchlighter/common_library/cjs/data/config"

export interface AppConfiguration {
    source: string;

    /** Only needed if using named, non-defauly export */
    export?: string;

    watch?: {
        config?: boolean;
        source?: boolean;
    }

    logs?: string | {
        file?: string;
        level?: "error" | "warn" | "info" | "debug";
    }

    config: any;
}

export const defaultAppConfig: AppConfiguration = {
    source: null,
    export: "default",
    logs: {},
    config: {},
}

export const AppConfigMerger = merger<AppConfiguration>({
    watch: merger(),
    logs: merger({
        
    }, (v) => (typeof v == 'string' ? { file: v } : v)),
})

