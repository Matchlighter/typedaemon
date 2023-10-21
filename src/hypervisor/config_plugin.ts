
import { merger } from "@matchlighter/common_library/data/config";

import { PLUGIN_TYPES } from "..";
import { HomeAssistantPluginConfig } from "../plugins/home_assistant";
import { HttpPluginConfig } from "../plugins/http";
import { MQTTPluginConfig } from "../plugins/mqtt";
import { LogLevel } from "./logging";

export interface BasePluginConfig {
    watch?: {
        config?: boolean;
    }

    logging?: {
        file?: string;
        level?: LogLevel;
    }
}

export interface OtherPluginConfig {
    type: string;
    [key: string]: any;
}

export type PluginType = keyof (typeof PLUGIN_TYPES);
export type PluginClass<P extends PluginType> = (typeof PLUGIN_TYPES)[P];
type BuiltinPluginConfigMap = {
    // [K in PluginType]: PluginClass<K> extends typeof Plugin<infer C> ? C : never
    home_assistant: HomeAssistantPluginConfig;
    mqtt: MQTTPluginConfig;
    http: HttpPluginConfig;
}
export type PluginConfig<P extends PluginType> = BuiltinPluginConfigMap[P];

type BuiltinPluginConfig = BuiltinPluginConfigMap[keyof BuiltinPluginConfigMap];
export type PluginConfiguration = BasePluginConfig & (BuiltinPluginConfig | OtherPluginConfig);

export const defaultPluginConfig: PluginConfiguration = {
    type: null,
}

export const PluginConfigMerger = merger<PluginConfiguration>({
    watch: merger(),
    logs: merger({

    }, (v) => (typeof v == 'string' ? { file: v } : v)),
})

