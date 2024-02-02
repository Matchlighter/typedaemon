
import { HomeAssistantPlugin } from "./home_assistant/plugin";
import { HttpPlugin } from "./http/plugin";
import { MqttPlugin } from "./mqtt/plugin";

export const PLUGIN_TYPES = {
    "home_assistant": HomeAssistantPlugin,
    "mqtt": MqttPlugin,
    "http": HttpPlugin,
}

export { api as ha } from "./home_assistant/api"
export { api as mqtt } from "./mqtt/api"
export { api as http } from "./http/api"
