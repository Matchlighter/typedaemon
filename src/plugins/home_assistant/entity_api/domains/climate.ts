import { action, observable } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export type ClimateMode = "auto" | "off" | "cool" | "heat" | "dry" | "fan_only" | "heat_cool";
export type ClimateAction = "off" | "heating" | "cooling" | "drying" | "idle" | "fan";

const DEFAULT_MODES: string[] = ["auto", "off", "cool", "heat", "dry", "fan_only"];

export interface ClimateOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Available HVAC modes; subset of HA's list. HA default: auto, off, cool, heat, dry, fan_only */
    modes?: ClimateMode[];
    /** Lowest settable temperature. HA default: 7C / 44.6F */
    min_temp?: number;
    /** Highest settable temperature. HA default: 35C / 95F */
    max_temp?: number;
    /** `0.1`, `0.5` or `1.0`. HA default: 0.1 (C), 1.0 (F) */
    precision?: 0.1 | 0.5 | 1;
    /** Setpoint step size. HA default: 1 */
    temp_step?: number;
    /** `C` or `F`. HA default: system unit */
    temperature_unit?: "C" | "F";
    /** Payload sent for `turn_on`. HA default: `ON` */
    payload_on?: string;
    /** Payload sent for `turn_off`. HA default: `OFF` */
    payload_off?: string;
    /** Enable dual setpoints (`target_temperature_high`/`_low`) */
    high_low?: boolean;
    /** Enable current temperature (`current_temperature`) reporting */
    current_temperature?: boolean;
    /** Enable current humidity (`current_humidity`) reporting */
    current_humidity?: boolean;
    /** Enable target humidity (`target_humidity`) reporting and commands */
    target_humidity?: boolean;
    /** Lowest target humidity (requires `target_humidity`). HA default: 30 */
    min_humidity?: number;
    /** Highest target humidity (requires `target_humidity`). HA default: 99 */
    max_humidity?: number;
    /** Fan modes; enables `fan_mode` reporting and commands */
    fan_modes?: string[];
    /** Swing modes; enables `swing_mode` reporting and commands */
    swing_modes?: string[];
    /** Preset modes (e.g. `eco`, `away`); enables `preset_mode` reporting and commands */
    preset_modes?: string[];
    /** Enable current action (`action`) reporting */
    action?: boolean;
}

type ClimateServices = {
    turn_on: [];
    turn_off: [];
    set_hvac_mode: [mode: string];
    set_temperature: [temperature: number];
    set_temperature_range: [range: { high?: number, low?: number }];
    set_humidity: [humidity: number];
    set_fan_mode: [mode: string];
    set_swing_mode: [mode: string];
    set_preset_mode: [mode: string];
}

/**
 * MQTT Climate (HVAC). The entity `state` is the HVAC mode (HA has no separate power state: power is command-only,
 * and `turn_on`/`turn_off` are never applied optimistically - report the result via `state`).
 * All other values are published as fields of the JSON state payload.
 * Commands call the matching `on_*` handler; when a handler isn't set the command is applied optimistically.
 * Dual-setpoint commands call `on_set_temperature_range({ high })` / `({ low })` with the one changed bound.
 */
export class TDClimate extends EntityClass<string | undefined, ClimateServices, ClimateOptions> {
    static domain = "climate";

    static { this._defaultAutocleaner(); }

    @observable accessor target_temperature: number | undefined;
    @observable accessor target_temperature_high: number | undefined;
    @observable accessor target_temperature_low: number | undefined;
    @observable accessor current_temperature: number | undefined;
    @observable accessor current_humidity: number | undefined;
    @observable accessor target_humidity: number | undefined;
    @observable accessor fan_mode: string | undefined;
    @observable accessor swing_mode: string | undefined;
    @observable accessor preset_mode: string | undefined;
    @observable accessor action: ClimateAction | undefined;

    on_turn_on?: () => void;
    on_turn_off?: () => void;
    on_set_mode?: (mode: string) => void;
    on_set_temperature?: (temperature: number) => void;
    on_set_temperature_range?: (range: { high?: number, low?: number }) => void;
    on_set_humidity?: (humidity: number) => void;
    on_set_fan_mode?: (mode: string) => void;
    on_set_swing_mode?: (mode: string) => void;
    on_set_preset_mode?: (mode: string) => void;

    private has(list: "fan_modes" | "swing_modes" | "preset_modes") { return !!this.options?.[list]?.length }

    // No primary `command_topic` in HA's climate schema
    protected command_keys(): string[] {
        const keys = ["power_command", "mode_command", "temperature_command"];
        if (this.options?.high_low) keys.push("temperature_high_command", "temperature_low_command");
        if (this.options?.target_humidity) keys.push("target_humidity_command");
        if (this.has("fan_modes")) keys.push("fan_mode_command");
        if (this.has("swing_modes")) keys.push("swing_mode_command");
        if (this.has("preset_modes")) keys.push("preset_mode_command");
        return keys;
    }

    protected getStateFields() {
        const o = this.options;
        const f: Record<string, any> = { temperature: this.target_temperature };
        if (o?.high_low) {
            f.temperature_high = this.target_temperature_high;
            f.temperature_low = this.target_temperature_low;
        }
        if (o?.current_temperature) f.current_temperature = this.current_temperature;
        if (o?.current_humidity) f.current_humidity = this.current_humidity;
        if (o?.target_humidity) f.target_humidity = this.target_humidity;
        if (this.has("fan_modes")) f.fan_mode = this.fan_mode;
        if (this.has("swing_modes")) f.swing_mode = this.swing_mode;
        if (this.has("preset_modes")) f.preset_mode = this.preset_mode;
        if (o?.action) f.action = this.action;
        return f;
    }

    protected discovery_data() {
        const o = this.options;
        const dd = super.discovery_data();
        // State is only reported via per-field topics
        delete (dd as any).command_topic;
        delete (dd as any).state_topic;
        delete (dd as any).value_template;
        const field = (name: string, topic: string, template: string, field = name) => ({
            [topic]: this.mqtt_state_topic,
            [template]: `{{ value_json.${field} }}`,
        });
        Object.assign(dd, {
            ...field("state", "mode_state_topic", "mode_state_template"),
            ...field("temperature", "temperature_state_topic", "temperature_state_template"),
            ...discoveryPassOptions(o, ["modes", "min_temp", "max_temp", "precision", "temp_step", "temperature_unit", "payload_on", "payload_off"]),
        });
        if (o?.high_low) {
            Object.assign(dd,
                field("temperature_high", "temperature_high_state_topic", "temperature_high_state_template"),
                field("temperature_low", "temperature_low_state_topic", "temperature_low_state_template"));
        }
        if (o?.current_temperature) Object.assign(dd, field("current_temperature", "current_temperature_topic", "current_temperature_template"));
        if (o?.current_humidity) Object.assign(dd, field("current_humidity", "current_humidity_topic", "current_humidity_template"));
        if (o?.target_humidity) {
            Object.assign(dd,
                field("target_humidity", "target_humidity_state_topic", "target_humidity_state_template"),
                discoveryPassOptions(o, ["min_humidity", "max_humidity"]));
        }
        if (this.has("fan_modes")) Object.assign(dd, { fan_modes: o!.fan_modes }, field("fan_mode", "fan_mode_state_topic", "fan_mode_state_template"));
        if (this.has("swing_modes")) Object.assign(dd, { swing_modes: o!.swing_modes }, field("swing_mode", "swing_mode_state_topic", "swing_mode_state_template"));
        if (this.has("preset_modes")) Object.assign(dd, { preset_modes: o!.preset_modes }, field("preset_mode", "preset_mode_state_topic", "preset_mode_value_template"));
        if (o?.action) Object.assign(dd, field("action", "action_topic", "action_template"));
        return dd;
    }

    @action
    handle_command(payload: any, key?: string) {
        const o = this.options;
        const setTemp = (prop: "target_temperature" | "target_temperature_high" | "target_temperature_low", handler: () => ((t: number) => void) | undefined) => {
            const t = parseFloat(payload);
            if (isNaN(t)) return;
            if ((o?.min_temp != null && t < o.min_temp) || (o?.max_temp != null && t > o.max_temp)) return;
            const h = handler();
            if (h) return h(t);
            this[prop] = t;
        };
        const setChoice = (list: string[] | undefined, prop: "fan_mode" | "swing_mode" | "preset_mode", h?: (m: string) => void) => {
            if (!list?.includes(payload)) return;
            if (h) return h.call(this, payload);
            this[prop] = payload;
        };

        switch (key) {
            case "power_command": {
                const handler = payload == (o?.payload_on ?? "ON") ? this.on_turn_on
                    : payload == (o?.payload_off ?? "OFF") ? this.on_turn_off : undefined;
                return handler?.call(this);
            }
            case "mode_command":
                if (!(o?.modes ?? DEFAULT_MODES).includes(payload)) return;
                if (this.on_set_mode) return this.on_set_mode(payload);
                this.state = payload;
                return;
            case "temperature_command":
                return setTemp("target_temperature", () => this.on_set_temperature);
            case "temperature_high_command":
                return setTemp("target_temperature_high", () => this.on_set_temperature_range && ((high) => this.on_set_temperature_range!({ high })));
            case "temperature_low_command":
                return setTemp("target_temperature_low", () => this.on_set_temperature_range && ((low) => this.on_set_temperature_range!({ low })));
            case "target_humidity_command": {
                const h = parseFloat(payload);
                if (isNaN(h)) return;
                if (h < (o?.min_humidity ?? 30) || h > (o?.max_humidity ?? 99)) return;
                if (this.on_set_humidity) return this.on_set_humidity(h);
                this.target_humidity = h;
                return;
            }
            case "fan_mode_command": return setChoice(o?.fan_modes, "fan_mode", this.on_set_fan_mode);
            case "swing_mode_command": return setChoice(o?.swing_modes, "swing_mode", this.on_set_swing_mode);
            case "preset_mode_command": return setChoice(o?.preset_modes, "preset_mode", this.on_set_preset_mode);
        }
    }
}
