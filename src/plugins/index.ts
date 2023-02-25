import { HomeAssistantPlugin } from "./home_assistant";

export const PLUGIN_TYPES = {
    "home_assistant": HomeAssistantPlugin,
    // "mqtt"
}

export { api as ha } from "./home_assistant/api"
export { api as mqtt } from "./mqtt/api"
