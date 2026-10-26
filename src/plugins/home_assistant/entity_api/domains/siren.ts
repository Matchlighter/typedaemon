import { action } from "mobx";
import { useStateValueTemplate } from "../general";
import { BooleanEntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions, parseJsonOrRaw, parseOnOff } from "./base";

export interface SirenOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** List of available tones. Enables `tone` support and the `tone` attribute. */
    available_tones?: string[];

    /** Enables the `duration` turn-on parameter and attribute. HA default: true */
    support_duration?: boolean;

    /** Enables the `volume_set` turn-on parameter and `volume_level` attribute. HA default: true */
    support_volume_set?: boolean;
}

/** Turn-on parameters HA includes in the default JSON command, mirrored as attributes */
const TURN_ON_PARAMS = ["tone", "duration", "volume_level"] as const;

type SirenServices = {
    turn_on: [params?: { tone?: string, duration?: number, volume_level?: number }];
    turn_off: [];
}

/**
 * MQTT Siren. Uses HA's default command format: `{"state":"ON","tone":..,"duration":..,"volume_level":..}`
 * (plain `ON`/`OFF` also accepted). Turn-on parameters are exposed as attributes.
 */
export class TDSiren extends BooleanEntityClass<SirenServices, SirenOptions> {
    static domain = "siren";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        useStateValueTemplate(dd);
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "available_tones",
                "support_duration",
                "support_volume_set",
            ]),
        })
        return dd;
    }

    @action
    handle_command(payload: any) {
        // JSON `{"state", ...params}` or plain ON/OFF; malformed JSON is ignored
        const p = parseJsonOrRaw(payload);
        const params: Record<string, any> = typeof p == "object" ? p : {};
        const on = parseOnOff(typeof p == "object" ? p.state : p);
        if (on === true) {
            const attrs: Record<string, any> = {};
            for (const k of TURN_ON_PARAMS) if (params[k] !== undefined) attrs[k] = params[k];
            this.setState(true, attrs);
        } else if (on === false) {
            this.setState(false);
        }
    }
}
