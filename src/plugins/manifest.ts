import { registerInternalKeyPrefix } from "../hypervisor/persistent_storage";
import { ENTITY_STATE_KEY_PREFIX, HA_PLUGIN_KEY_PREFIX } from "./home_assistant/storage_keys";

/**
 * What the core needs to know about a built-in plugin type without loading the plugin itself (`PLUGIN_TYPES`
 * is only loaded once a plugin is configured, to avoid import cycles). Keep this module's imports light.
 */
export interface PluginManifest {
    /** Prefixes of persisted keys that are TypeDaemon bookkeeping rather than user data */
    internalKeyPrefixes?: string[];
}

export const PLUGIN_MANIFESTS: Record<string, PluginManifest> = {
    home_assistant: { internalKeyPrefixes: [HA_PLUGIN_KEY_PREFIX, ENTITY_STATE_KEY_PREFIX] },
};

/** Declares every built-in plugin type's internal keys, whether or not the plugin is configured */
export function registerPluginManifests() {
    for (const { internalKeyPrefixes = [] } of Object.values(PLUGIN_MANIFESTS)) {
        internalKeyPrefixes.forEach(registerInternalKeyPrefix);
    }
}
