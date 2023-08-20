
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, HATemplate, discoveryPassOptions } from "./base";

export interface LightOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Flag that defines if the light supports brightness. */
    brightness?: boolean;

    /** Defines the maximum brightness value (i.e., 100%) of the MQTT device. */
    brightness_scale?: number;

    /** Flag that defines if the light supports effects. */
    effect?: boolean;

    /** The list of effects the light supports. */
    effect_list?: string;

    /** The duration, in seconds, of a “long” flash. */
    flash_time_long?: number;

    /** The duration, in seconds, of a “short” flash. */
    flash_time_short?: number;

    /** The maximum color temperature in mireds. */
    max_mireds?: number;

    /** The minimum color temperature in mireds. */
    min_mireds?: number;

    /** Flag that defines if the light supports color modes. */
    color_mode?: boolean;

    /** A list of color modes supported by the list. This is required if color_mode is True. */
    supported_color_modes?: ("onoff" | "brightness" | "color_temp" | "hs" | "xy" | "rgb" | "rgbw" | "rgbww" | "white")[];

    /** Defines the maximum white level (i.e., 100%) of the MQTT device. This is used when setting the light to white mode. */
    white_scale?: number;
}

export class TDLight extends EntityClass<boolean, {}, LightOptions> {
    static domain = "light";

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            schema: "json",
            ...discoveryPassOptions(this.options, [
                "brightness",
                "brightness_scale",
                "effect",
                "effect_list",
                "flash_time_long",
                "flash_time_short",
                "max_mireds",
                "min_mireds",
                "color_mode",
                "supported_color_modes",
                "white_scale",
            ]),
        })
        return dd;
    }

    protected async handle_command(payload: any) {
        // TODO
    }
}
