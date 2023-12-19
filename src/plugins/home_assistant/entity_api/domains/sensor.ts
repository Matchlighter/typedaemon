
import { RawStatePayload } from "..";
import { EntityClass, EntityOptionsCommon, HATemplate, discoveryPassOptions } from "./base";

type SensorDeviceClass = string;

export interface SensorOptions extends EntityOptionsCommon {
    /** The type/class of the sensor to set the icon in the frontend. The device_class can be null. */
    device_class?: SensorDeviceClass;

    /** If set, it defines the number of seconds after the sensor’s state expires, if it’s not updated. After expiry, the sensor’s state becomes unavailable. Default the sensors state never expires. */
    expire_after?: number;

    /** Sends update events even if the value hasn’t changed. Useful if you want to have meaningful value graphs in history. */
    force_update?: boolean;

    /** The number of decimals which should be used in the sensor’s state after rounding. */
    suggested_display_precision?: number;

    /** The state_class of the sensor. */
    state_class?: "measurement" | "total" | "total_increasing";

    /** Defines the units of measurement of the sensor, if any. The unit_of_measurement can be null. */
    unit_of_measurement?: string;

    // /** Defines a template to extract the value. If the template throws an error, the current state will be used instead. */
    // value_template?: HATemplate;

    /** Defines a template to extract the last_reset. Available variables: entity_id. The entity_id can be used to reference the entity’s attributes. */
    last_reset_value_template?: HATemplate;
}

export class TDSensor extends EntityClass<number, {}, SensorOptions> {
    static domain = "sensor";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "device_class",
                "expire_after",
                "force_update",
                "suggested_display_precision",
                "unit_of_measurement",
            ]),

            state_class: this.options?.state_class || "measurement",

            last_reset_value_template: "{{ value_json.last_reset or state_attr(entity_id, 'last_reset') }}",
        })
        return dd;
    }

    updateWithReset(value: number) {
        // TODO
    }

    protected _publishState(state: RawStatePayload<number>) {
        // TODO last_reset
        return super._publishState({ ...state, last_reset: null })
    }
}
