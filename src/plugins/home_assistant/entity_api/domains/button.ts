
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, HATemplate, discoveryPassOptions } from "./base";

type ButtonDeviceClass = string;

export interface ButtonOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /* The type/class of the button to set the icon in the frontend. The device_class can be null. */
    device_class?: ButtonDeviceClass;
}

export class TDButton extends EntityClass<boolean, {}, ButtonOptions> {
    static domain = "button";

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "device_class",
            ]),
        })
        return dd;
    }

    protected async handle_command(payload: any) {
        // if (payload == "PRESS") // TODO
    }
}