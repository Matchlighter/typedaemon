import { action, observable } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export type FanDirection = "forward" | "reverse";

export interface FanOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Enable speed percentage reporting (`percentage`) and commands */
    percentage?: boolean;
    /** Lowest speed step (represents 0 %; off is not included). HA default: 1 */
    speed_range_min?: number;
    /** Highest speed step (100 %). HA default: 100 */
    speed_range_max?: number;

    /** Supported preset modes (e.g. `auto`, `eco`). Enables preset mode reporting and commands */
    preset_modes?: string[];

    /** Enable oscillation reporting (`oscillating`) and commands */
    oscillation?: boolean;

    /** Enable direction (`forward`/`reverse`) reporting and commands */
    direction?: boolean;
}

type FanServices = {
    turn_on: [];
    turn_off: [];
    set_percentage: [percentage: number];
    set_preset_mode: [preset_mode: string];
    oscillate: [oscillating: boolean];
    set_direction: [direction: FanDirection];
}

/** HA's default `payload_oscillation_on`/`payload_oscillation_off` */
const OSCILLATION = { oscillate_on: true, oscillate_off: false } as const;

/**
 * MQTT Fan. State is boolean (on/off). Commands from HA call the matching `on_*` handler; when a handler isn't set
 * the command is applied optimistically.
 * `percentage`, `preset_mode`, `oscillating` and `direction` are published as fields of the JSON state payload.
 */
export class TDFan extends EntityClass<boolean, FanServices, FanOptions> {
    static domain = "fan";

    static { this._defaultAutocleaner(); }

    @observable accessor percentage: number | undefined;
    @observable accessor preset_mode: string | undefined;
    @observable accessor oscillating: boolean | undefined;
    @observable accessor direction: FanDirection | undefined;

    on_turn_on?: () => void;
    on_turn_off?: () => void;
    on_set_percentage?: (percentage: number) => void;
    on_set_preset_mode?: (preset_mode: string) => void;
    on_set_oscillating?: (oscillating: boolean) => void;
    on_set_direction?: (direction: FanDirection) => void;

    private get has_preset_modes() { return !!this.options?.preset_modes?.length }

    protected command_keys(): string[] {
        const keys = [...super.command_keys()];
        if (this.options?.percentage) keys.push("percentage_command");
        if (this.has_preset_modes) keys.push("preset_mode_command");
        if (this.options?.oscillation) keys.push("oscillation_command");
        if (this.options?.direction) keys.push("direction_command");
        return keys;
    }

    protected getStateFields() {
        const f: Record<string, any> = {};
        if (this.options?.percentage) f.percentage = this.percentage;
        if (this.has_preset_modes) f.preset_mode = this.preset_mode;
        if (this.options?.oscillation) f.oscillating = this.oscillating;
        if (this.options?.direction) f.direction = this.direction;
        return f;
    }

    protected _serializeState(state: boolean) {
        if (state === true) return "ON";
        if (state === false) return "OFF";
        return state;
    }

    protected discovery_data() {
        const dd = super.discovery_data();
        // HA's fan uses `state_value_template` (not `value_template`) for the main state
        Object.assign(dd, { state_value_template: "{{ value_json.state }}" });
        delete (dd as any).value_template;
        if (this.options?.percentage) {
            Object.assign(dd, {
                percentage_state_topic: this.mqtt_state_topic,
                percentage_value_template: "{{ value_json.percentage }}",
                ...discoveryPassOptions(this.options, ["speed_range_min", "speed_range_max"]),
            });
        }
        if (this.has_preset_modes) {
            Object.assign(dd, {
                preset_modes: this.options!.preset_modes,
                preset_mode_state_topic: this.mqtt_state_topic,
                preset_mode_value_template: "{{ value_json.preset_mode }}",
            });
        }
        if (this.options?.oscillation) {
            Object.assign(dd, {
                oscillation_state_topic: this.mqtt_state_topic,
                oscillation_value_template: "{{ 'oscillate_on' if value_json.oscillating else 'oscillate_off' }}",
            });
        }
        if (this.options?.direction) {
            Object.assign(dd, {
                direction_state_topic: this.mqtt_state_topic,
                direction_value_template: "{{ value_json.direction }}",
            });
        }
        return dd;
    }

    @action
    handle_command(payload: any, key?: string) {
        if (key == "command") {
            if (payload != "ON" && payload != "OFF") return;
            const handler = payload == "ON" ? this.on_turn_on : this.on_turn_off;
            if (handler) return handler.call(this);
            this.state = payload == "ON";
        } else if (key == "percentage_command") {
            const pct = parseFloat(payload);
            if (isNaN(pct)) return;
            if (this.on_set_percentage) return this.on_set_percentage(pct);
            this.percentage = pct;
            this.state = pct > 0;
        } else if (key == "preset_mode_command") {
            if (!this.options?.preset_modes?.includes(payload)) return;
            if (this.on_set_preset_mode) return this.on_set_preset_mode(payload);
            this.preset_mode = payload;
        } else if (key == "oscillation_command") {
            if (!(payload in OSCILLATION)) return;
            const osc = OSCILLATION[payload as keyof typeof OSCILLATION];
            if (this.on_set_oscillating) return this.on_set_oscillating(osc);
            this.oscillating = osc;
        } else if (key == "direction_command") {
            if (payload != "forward" && payload != "reverse") return;
            if (this.on_set_direction) return this.on_set_direction(payload);
            this.direction = payload;
        }
    }
}
