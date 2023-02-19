
import { merger } from "@matchlighter/common_library/cjs/data/config"

export interface AppConfiguration {
    source: string;

    /** Only needed if using named, non-defauly export */
    export?: string;

    watch?: {
        config?: boolean;
        source?: boolean;
    }

    config: any;
}

export const defaultAppConfig: AppConfiguration = {
    source: null,
    export: "default",
    config: {},
}

export const AppConfigMerger = merger<AppConfiguration>({
    watch: merger(),
})

