
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, HATemplate, discoveryPassOptions } from "./base";

type SwitchDeviceClass = string;

export interface SwitchOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /* The type/class of the switch to set the icon in the frontend. The device_class can be null. */
    device_class?: SwitchDeviceClass;

    // /* The payload that represents off state. If specified, will be used for both comparing to the value in the state_topic (see value_template and state_off for details) and sending as off command to the command_topic. */
    // payload_off?: string;

    // /* The payload that represents on state. If specified, will be used for both comparing to the value in the state_topic (see value_template and state_on for details) and sending as on command to the command_topic. */
    // payload_on?: string;

    // /**
    //  * The payload that represents the off state. Used when value that represents off state in the state_topic is different from value that should be sent to the command_topic to turn the device off.
    //  * Default: payload_off if defined, else OFF
    //  */
    // state_off?: string;

    // /**
    //  * The payload that represents the on state. Used when value that represents on state in the state_topic is different from value that should be sent to the command_topic to turn the device on.
    //  * Default: payload_on if defined, else ON
    //  */
    // state_on?: string;

    // /* Defines a template to extract device’s state from the state_topic. To determine the switches’s state result of this template will be compared to state_on and state_off. */
    // value_template?: HATemplate;
}

type SwitchServices = {
    turn_on: [value: boolean];
    turn_off: [value: string];
}

export class TDSwitch extends EntityClass<boolean, SwitchServices, SwitchOptions> {
    static domain = "switch";

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "device_class",
            ]),
        })
        return dd;
    }

    protected _serializeState(state: boolean) {
        if (state === true) return "ON";
        if (state === false) return "OFF";
        return state;
    }

    protected async handle_command(payload: any) {
        // if (payload == "ON") // TODO
        // if (payload == "OFF") // TODO
    }
}
