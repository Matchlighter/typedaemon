
import { merger } from "@matchlighter/common_library/cjs/data/config"

interface Base {
    watch?: {
        config?: boolean;
    }

    logs?: string | {
        file?: string;
        level?: "error" | "warn" | "info" | "debug";
    }
}

interface HomeAssistant {
    type: "home_assistant";
    url: string;
    access_token: string;
}

interface MQTT {
    type: "mqtt";
    url: string;
}

interface Other {
    type: string;
    [key: string]: any;
}

export interface PluginType {
    base: Base;
    home_assistant: HomeAssistant;
    mqtt: MQTT;
}

export type PluginConfiguration = Base & (HomeAssistant | MQTT | Other);

export const defaultPluginConfig: PluginConfiguration = {
    type: null,
}

export const PluginConfigMerger = merger<PluginConfiguration>({
    watch: merger(),
    logs: merger({
        
    }, (v) => (typeof v == 'string' ? { file: v } : v)),
})

