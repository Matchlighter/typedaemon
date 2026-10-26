import { action } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

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
export class TDSiren extends EntityClass<boolean, SirenServices, SirenOptions> {
    static domain = "siren";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        // Siren reads its state via state_value_template
        delete (dd as any).value_template;
        Object.assign(dd, {
            state_value_template: "{{ value_json.state }}",
            ...discoveryPassOptions(this.options, [
                "available_tones",
                "support_duration",
                "support_volume_set",
            ]),
        })
        return dd;
    }

    protected _serializeState(state: boolean) {
        if (state === true) return "ON";
        if (state === false) return "OFF";
        return state;
    }

    @action
    handle_command(payload: any) {
        let state: unknown = payload;
        let params: Record<string, any> = {};
        if (typeof payload == "string" && payload.trim().startsWith("{")) {
            try {
                const parsed = JSON.parse(payload);
                state = parsed.state;
                params = parsed;
            } catch { return }
        } else if (payload && typeof payload == "object") {
            state = payload.state;
            params = payload;
        }

        if (state == "ON") {
            const attrs: Record<string, any> = {};
            for (const k of TURN_ON_PARAMS) if (params[k] !== undefined) attrs[k] = params[k];
            this.setState(true, attrs);
        } else if (state == "OFF") {
            this.setState(false);
        }
    }
}
