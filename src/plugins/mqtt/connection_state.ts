import type { PluginConnectionState } from "../base";

/** The one state shown for a plugin that holds several MQTT clients (its own and one per app) */
export function aggregateMqttState(clients: { connected: boolean; reconnecting: boolean }[]): PluginConnectionState | undefined {
    if (!clients.length) return undefined;
    if (clients.every(c => c.connected)) return 'connected';
    if (clients.some(c => c.reconnecting)) return 'reconnecting';
    return 'disconnected';
}
