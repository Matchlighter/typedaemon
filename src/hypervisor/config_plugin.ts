
import { merger } from "@matchlighter/common_library/data/config"
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

export interface HomeAssistantPluginConfig {
    type: "home_assistant";
    url: string;
    access_token: string;
    mqtt_plugin?: string;
}

export interface MQTTPluginConfig {
    type: "mqtt";
    base_topic?: string;
    url?: string;
    host?: string;
    username?: string;
    password?: string;
}

export interface OtherPluginConfig {
    type: string;
    [key: string]: any;
}

export interface PluginType {
    base: BasePluginConfig;
    home_assistant: HomeAssistantPluginConfig;
    mqtt: MQTTPluginConfig;
}

export type PluginConfiguration = BasePluginConfig & (HomeAssistantPluginConfig | MQTTPluginConfig | OtherPluginConfig);

export const defaultPluginConfig: PluginConfiguration = {
    type: null,
}

export const PluginConfigMerger = merger<PluginConfiguration>({
    watch: merger(),
    logs: merger({
        
    }, (v) => (typeof v == 'string' ? { file: v } : v)),
})

