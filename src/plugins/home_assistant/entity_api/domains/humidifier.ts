import { action, observable } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export type HumidifierDeviceClass = "humidifier" | "dehumidifier";
export type HumidifierAction = "off" | "humidifying" | "drying" | "idle";

export interface HumidifierOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** `humidifier` (default) or `dehumidifier` */
    device_class?: HumidifierDeviceClass;
    /** Lowest settable target humidity. HA default: 0 */
    min_humidity?: number;
    /** Highest settable target humidity. HA default: 100 */
    max_humidity?: number;
    /** Available modes (e.g. `auto`, `sleep`). Enables mode reporting and commands */
    modes?: string[];
    /** Enable current humidity (`current_humidity`) reporting */
    current_humidity?: boolean;
    /** Enable current action (`action`) reporting */
    action?: boolean;
}

type HumidifierServices = {
    turn_on: [];
    turn_off: [];
    set_humidity: [humidity: number];
    set_mode: [mode: string];
}

/**
 * MQTT Humidifier. State is boolean (on/off). Commands from HA call the matching `on_*` handler; when a handler isn't
 * set the command is applied optimistically.
 * `target_humidity`, `mode`, `current_humidity` and `action` are published as fields of the JSON state payload.
 */
export class TDHumidifier extends EntityClass<boolean, HumidifierServices, HumidifierOptions> {
    static domain = "humidifier";

    static { this._defaultAutocleaner(); }

    @observable accessor target_humidity: number | undefined;
    @observable accessor mode: string | undefined;
    @observable accessor current_humidity: number | undefined;
    @observable accessor action: HumidifierAction | undefined;

    on_turn_on?: () => void;
    on_turn_off?: () => void;
    on_set_target_humidity?: (humidity: number) => void;
    on_set_mode?: (mode: string) => void;

    private get has_modes() { return !!this.options?.modes?.length }

    protected command_keys(): string[] {
        const keys = [...super.command_keys(), "target_humidity_command"];
        if (this.has_modes) keys.push("mode_command");
        return keys;
    }

    protected getStateFields() {
        const f: Record<string, any> = { target_humidity: this.target_humidity };
        if (this.has_modes) f.mode = this.mode;
        if (this.options?.current_humidity) f.current_humidity = this.current_humidity;
        if (this.options?.action) f.action = this.action;
        return f;
    }

    protected _serializeState(state: boolean) {
        if (state === true) return "ON";
        if (state === false) return "OFF";
        return state;
    }

    protected discovery_data() {
        const dd = super.discovery_data();
        // HA's humidifier uses `state_value_template` (not `value_template`) for the main state
        Object.assign(dd, {
            state_value_template: "{{ value_json.state }}",
            target_humidity_state_topic: this.mqtt_state_topic,
            target_humidity_state_template: "{{ value_json.target_humidity }}",
            ...discoveryPassOptions(this.options, ["device_class", "min_humidity", "max_humidity"]),
        });
        delete (dd as any).value_template;
        if (this.has_modes) {
            Object.assign(dd, {
                modes: this.options!.modes,
                mode_state_topic: this.mqtt_state_topic,
                mode_state_template: "{{ value_json.mode }}",
            });
        }
        if (this.options?.current_humidity) {
            Object.assign(dd, {
                current_humidity_topic: this.mqtt_state_topic,
                current_humidity_template: "{{ value_json.current_humidity }}",
            });
        }
        if (this.options?.action) {
            Object.assign(dd, {
                action_topic: this.mqtt_state_topic,
                action_template: "{{ value_json.action }}",
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
        } else if (key == "target_humidity_command") {
            const h = parseFloat(payload);
            if (isNaN(h)) return;
            if (h < (this.options?.min_humidity ?? 0) || h > (this.options?.max_humidity ?? 100)) return;
            if (this.on_set_target_humidity) return this.on_set_target_humidity(h);
            this.target_humidity = h;
        } else if (key == "mode_command") {
            if (!this.options?.modes?.includes(payload)) return;
            if (this.on_set_mode) return this.on_set_mode(payload);
            this.mode = payload;
        }
    }
}
