import { HomeAssistantPlugin } from "./home_assistant";
import { MqttPlugin } from "./mqtt";

export const PLUGIN_TYPES = {
    "home_assistant": HomeAssistantPlugin,
    "mqtt": MqttPlugin,
}

export { api as ha } from "./home_assistant/api"
export { api as mqtt } from "./mqtt/api"
