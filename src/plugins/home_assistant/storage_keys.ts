/** Prefix of the per-plugin-instance bookkeeping keys (eg. the entity auto-clean registry) */
export const HA_PLUGIN_KEY_PREFIX = "ha[";
/** Prefix of persisted entity state keys */
export const ENTITY_STATE_KEY_PREFIX = "entity_state:";

export const entityStateKey = (uuid: string) => `${ENTITY_STATE_KEY_PREFIX}${uuid}`;
