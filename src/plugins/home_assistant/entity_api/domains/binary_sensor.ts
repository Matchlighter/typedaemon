
import { EntityClass, EntityOptionsCommon, HATemplate, discoveryPassOptions } from "./base";

type BinarySensorDeviceClass = string;

export interface BinarySensorOptions extends EntityOptionsCommon {
    /** The type/class of the sensor to set the icon in the frontend. The device_class can be null. */
    device_class?: BinarySensorDeviceClass;

    /** If set, it defines the number of seconds after the sensor’s state expires, if it’s not updated. After expiry, the sensor’s state becomes unavailable. Default the sensors state never expires. */
    expire_after?: number;

    /** For sensors that only send on state updates (like PIRs), this variable sets a delay in seconds after which the sensor’s state will be updated back to off. */
    off_delay?: number;

    /** Sends update events even if the value hasn’t changed. Useful if you want to have meaningful value graphs in history. */
    force_update?: boolean;

    // /** Defines a template to extract the value. If the template throws an error, the current state will be used instead. */
    // value_template?: HATemplate;

    // /** The payload that represents off state. If specified, will be used for both comparing to the value in the state_topic (see value_template and state_off for details) and sending as off command to the command_topic. */
    // payload_off?: string;

    // /** The payload that represents on state. If specified, will be used for both comparing to the value in the state_topic (see value_template and state_on for details) and sending as on command to the command_topic. */
    // payload_on?: string;
}

export class TDBinarySensor extends EntityClass<boolean, {}, BinarySensorOptions> {
    static domain = "binary_sensor";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "device_class",
                "expire_after",
                "off_delay",
                "force_update",
            ]),
        })
        return dd;
    }

    protected _serializeState(state: boolean) {
        if (state === true) return "ON";
        if (state === false) return "OFF";
        return state;
    }
}
