
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

type NumberDeviceClass = string;

export interface NumberOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /* The type/class of the number to set the icon in the frontend. The device_class can be null. */
    device_class?: NumberDeviceClass;

    /** Minimum value. */
    min?: number;

    /** Maximum value. */
    max?: number;

    /** Control how the number should be displayed in the UI. Can be set to box or slider to force a display mode. */
    mode?: "auto" | "slider" | "box";

    /** Step value. Smallest value 0.001. */
    step?: number;

    /** Defines the unit of measurement of the sensor, if any. The unit_of_measurement can be null. */
    unit_of_measurement?: string;
}

export class TDNumber extends EntityClass<number, {}, NumberOptions> {
    static domain = "number";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "device_class",
                "min",
                "max",
                "mode",
                "step",
                "unit_of_measurement",
            ]),
        })
        return dd;
    }

    protected async handle_command(payload: any) {
        // TODO
    }
}
