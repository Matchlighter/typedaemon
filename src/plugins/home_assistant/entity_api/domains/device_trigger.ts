
import { action } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, HATemplate, discoveryPassOptions } from "./base";
import { RawStatePayload } from "..";

export interface DeviceTriggerOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** The type of the trigger, e.g. button_short_press. Entries supported by the frontend: button_short_press, button_short_release, button_long_press, button_long_release, button_double_press, button_triple_press, button_quadruple_press, button_quintuple_press. If set to an unsupported value, will render as subtype type, e.g. button_1 spammed with type set to spammed and subtype set to button_1 */
    type: string;

    /** The subtype of the trigger, e.g. button_1. Entries supported by the frontend: turn_on, turn_off, button_1, button_2, button_3, button_4, button_5, button_6. If set to an unsupported value, will render as subtype type, e.g. left_button pressed with type set to button_short_press and subtype set to left_button */
    subtype: string;
}

export class TDDeviceTrigger extends EntityClass<boolean, {}, DeviceTriggerOptions> {
    static domain = "device_automation";

    static { this._defaultAutocleaner(); }

    // TODO Could we have a single topic per app and use payload: param? Would there be ay point?

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            automation_type: "trigger",
            ...discoveryPassOptions(this.options, [
                "type",
                "subtype",
            ]),
            topic: dd.state_topic,
            payload: "TRIGGER",
        })
        delete dd.state_topic;
        return dd;
    }

    @action trigger() {
        this.mqttConn.publish(this.mqtt_state_topic, "TRIGGER");
    }

    protected _publishState(v: RawStatePayload<boolean>): void {
        // Not Implemented
    }
}
