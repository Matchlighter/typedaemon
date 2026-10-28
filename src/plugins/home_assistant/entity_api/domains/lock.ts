
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, HATemplate, discoveryPassOptions } from "./base";

export interface LockOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** A regular expression to validate a supplied code when it is set during the service call to open, lock or unlock the MQTT lock. */
    code_format?: string;

    // /** The payload that represents the available state. */
    // payload_available?: string;

    // /** The payload sent to the lock to lock it. */
    // payload_lock?: string;

    // /** The payload that represents the unavailable state. */
    // payload_not_available?: string;

    // /** The payload sent to the lock to unlock it. */
    // payload_unlock?: string;

    // /** The payload sent to the lock to open it. */
    // payload_open?: string;

    // /** A special payload that resets the state to unknown when received on the state_topic. */
    // payload_reset?: string;

    // /** The payload sent to state_topic by the lock when it’s jammed. */
    // state_jammed?: string;

    // /** The payload sent to state_topic by the lock when it’s locked. */
    // state_locked?: string;

    // /** The payload sent to state_topic by the lock when it’s locking. */
    // state_locking?: string;

    // /** The payload sent to state_topic by the lock when it’s unlocked. */
    // state_unlocked?: string;

    // /** The payload sent to state_topic by the lock when it’s unlocking. */
    // state_unlocking?: string;
}

export type LockState = "locked" | "unlocked" | "locking" | "unlocking" | "jammed" | "open" | "opening";

export class TDLock extends EntityClass<LockState, {}, LockOptions> {
    static domain = "lock";

    static { this._defaultAutocleaner(); }

    /** Handlers for HA commands. Update `state` from them (or let the device do so) to reflect the result. */
    on_lock: () => void;
    on_unlock: () => void;
    on_open: () => void;

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "code_format",
            ]),
        })
        return dd;
    }

    protected _serializeState(state: LockState) {
        return state?.toUpperCase();
    }

    handle_command(payload: any) {
        switch (payload) {
            case "LOCK": return this.on_lock?.();
            case "UNLOCK": return this.on_unlock?.();
            case "OPEN": return this.on_open?.();
        }
    }
}
