import { action, observable } from "mobx";
import { useStateValueTemplate } from "../general";
import { CommandHandlers, BooleanEntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions, parseNumberPayload, parseOnOff } from "./base";

export type HumidifierDeviceClass = "humidifier" | "dehumidifier";
export type HumidifierAction = "off" | "humidifying" | "drying" | "idle";

/** HA's default `min_humidity` / `max_humidity` for humidifiers */
const DEFAULT_MIN_HUMIDITY = 0;
const DEFAULT_MAX_HUMIDITY = 100;

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
    set_target_humidity: [humidity: number];
    set_mode: [mode: string];
}

/**
 * MQTT Humidifier. State is boolean (on/off). Commands from HA call the matching `on_*` handler; when a handler isn't
 * set the command is applied optimistically.
 * `target_humidity`, `mode`, `current_humidity` and `action` are published as fields of the JSON state payload.
 */
export class TDHumidifier extends BooleanEntityClass<HumidifierServices, HumidifierOptions> {
    static domain = "humidifier";

    static { this._defaultAutocleaner(); }

    @observable accessor target_humidity: number | undefined;
    @observable accessor mode: string | undefined;
    @observable accessor current_humidity: number | undefined;
    @observable accessor action: HumidifierAction | undefined;

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

    protected discovery_data() {
        const dd = super.discovery_data();
        useStateValueTemplate(dd);
        Object.assign(dd,
            this.stateField("target_humidity_state_topic", "target_humidity_state_template", "target_humidity"),
            discoveryPassOptions(this.options, ["device_class", "min_humidity", "max_humidity"]));
        if (this.has_modes) {
            Object.assign(dd, { modes: this.options!.modes }, this.stateField("mode_state_topic", "mode_state_template", "mode"));
        }
        if (this.options?.current_humidity) {
            Object.assign(dd, this.stateField("current_humidity_topic", "current_humidity_template", "current_humidity"));
        }
        if (this.options?.action) {
            Object.assign(dd, this.stateField("action_topic", "action_template", "action"));
        }
        return dd;
    }

    @action
    handle_command(payload: any, key?: string) {
        if (key == "command") {
            const on = parseOnOff(payload);
            if (on == null) return;
            this.dispatch(on ? this.on_turn_on : this.on_turn_off, [], () => { this.state = on });
        } else if (key == "target_humidity_command") {
            const h = parseNumberPayload(payload,
                this.options?.min_humidity ?? DEFAULT_MIN_HUMIDITY, this.options?.max_humidity ?? DEFAULT_MAX_HUMIDITY);
            if (h == null) return;
            this.dispatch(this.on_set_target_humidity, [h], () => { this.target_humidity = h });
        } else if (key == "mode_command") {
            if (!this.options?.modes?.includes(payload)) return;
            this.dispatch(this.on_set_mode, [payload], () => { this.mode = payload });
        }
    }
}

/** `on_<service>` handlers, called for commands from HA */
export interface TDHumidifier extends CommandHandlers<HumidifierServices> { }
