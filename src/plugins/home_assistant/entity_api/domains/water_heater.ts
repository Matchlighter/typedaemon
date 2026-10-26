import { action, observable } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export type WaterHeaterMode = "off" | "eco" | "electric" | "gas" | "heat_pump" | "high_demand" | "performance";

const DEFAULT_MODES: WaterHeaterMode[] = ["off", "eco", "electric", "gas", "heat_pump", "high_demand", "performance"];

export interface WaterHeaterOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Available modes; must be a subset of HA's list. HA default: all of them */
    modes?: WaterHeaterMode[];
    /** Lowest settable temperature. HA default: 43.3C / 110F */
    min_temp?: number;
    /** Highest settable temperature. HA default: 60C / 140F */
    max_temp?: number;
    /** `0.1`, `0.5` or `1.0`. HA default: 0.1 (C), 1.0 (F) */
    precision?: 0.1 | 0.5 | 1;
    /** `C` or `F`. HA default: system unit */
    temperature_unit?: "C" | "F";
    /** Payload sent for `turn_on`. HA default: `ON` */
    payload_on?: string;
    /** Payload sent for `turn_off`. HA default: `OFF` */
    payload_off?: string;
    /** Enable current temperature (`current_temperature`) reporting */
    current_temperature?: boolean;
}

type WaterHeaterServices = {
    turn_on: [];
    turn_off: [];
    set_temperature: [temperature: number];
    set_mode: [mode: string];
}

/**
 * MQTT Water Heater. The entity `state` is the current mode (HA has no separate power state: power is command-only,
 * and `turn_on`/`turn_off` are never applied optimistically - report the result via `state`).
 * `target_temperature` and `current_temperature` are published as fields of the JSON state payload.
 * Commands call the matching `on_*` handler; mode/temperature are applied optimistically when no handler is set.
 */
export class TDWaterHeater extends EntityClass<string | undefined, WaterHeaterServices, WaterHeaterOptions> {
    static domain = "water_heater";

    static { this._defaultAutocleaner(); }

    @observable accessor target_temperature: number | undefined;
    @observable accessor current_temperature: number | undefined;

    on_turn_on?: () => void;
    on_turn_off?: () => void;
    on_set_temperature?: (temperature: number) => void;
    on_set_mode?: (mode: string) => void;

    // No primary `command_topic` in HA's water_heater schema
    protected command_keys(): string[] {
        return ["power_command", "mode_command", "temperature_command"];
    }

    protected getStateFields() {
        const f: Record<string, any> = { temperature: this.target_temperature };
        if (this.options?.current_temperature) f.current_temperature = this.current_temperature;
        return f;
    }

    protected discovery_data() {
        const dd = super.discovery_data();
        // State is only reported via mode_state_topic
        delete (dd as any).command_topic;
        delete (dd as any).state_topic;
        delete (dd as any).value_template;
        Object.assign(dd, {
            mode_state_topic: this.mqtt_state_topic,
            mode_state_template: "{{ value_json.state }}",
            temperature_state_topic: this.mqtt_state_topic,
            temperature_state_template: "{{ value_json.temperature }}",
            ...discoveryPassOptions(this.options, ["modes", "min_temp", "max_temp", "precision", "temperature_unit", "payload_on", "payload_off"]),
        });
        if (this.options?.current_temperature) {
            Object.assign(dd, {
                current_temperature_topic: this.mqtt_state_topic,
                current_temperature_template: "{{ value_json.current_temperature }}",
            });
        }
        return dd;
    }

    @action
    handle_command(payload: any, key?: string) {
        if (key == "power_command") {
            const handler = payload == (this.options?.payload_on ?? "ON") ? this.on_turn_on
                : payload == (this.options?.payload_off ?? "OFF") ? this.on_turn_off : undefined;
            handler?.call(this);
        } else if (key == "mode_command") {
            if (!(this.options?.modes ?? DEFAULT_MODES).includes(payload)) return;
            if (this.on_set_mode) return this.on_set_mode(payload);
            this.state = payload;
        } else if (key == "temperature_command") {
            const t = parseFloat(payload);
            if (isNaN(t)) return;
            const { min_temp, max_temp } = this.options ?? {};
            if ((min_temp != null && t < min_temp) || (max_temp != null && t > max_temp)) return;
            if (this.on_set_temperature) return this.on_set_temperature(t);
            this.target_temperature = t;
        }
    }
}
