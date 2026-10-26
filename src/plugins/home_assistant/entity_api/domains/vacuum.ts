import { action, observable } from "mobx";
import { omitDiscoveryKeys } from "../general";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions, parseJsonOrRaw } from "./base";

export type VacuumState = "cleaning" | "docked" | "paused" | "idle" | "returning" | "error";
/** Values HA's MQTT vacuum accepts in `supported_features` */
export type VacuumFeature = "start" | "stop" | "pause" | "return_home" | "status" | "locate" | "clean_spot" | "fan_speed" | "send_command";

type VacuumCommand = "start" | "pause" | "stop" | "return_to_base" | "clean_spot" | "locate";
const COMMANDS: VacuumCommand[] = ["start", "pause", "stop", "return_to_base", "clean_spot", "locate"];

export interface VacuumOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Features to advertise. HA default: start, stop, return_home, status, clean_spot */
    supported_features?: VacuumFeature[];
    /** Available fan speeds. Enables `fan_speed` reporting and `set_fan_speed` commands */
    fan_speed_list?: string[];
    /** Enable the `send_command` topic */
    send_command?: boolean;
    payload_start?: string;
    payload_pause?: string;
    payload_stop?: string;
    payload_return_to_base?: string;
    payload_clean_spot?: string;
    payload_locate?: string;
}

type VacuumServices = {
    start: [];
    pause: [];
    stop: [];
    return_to_base: [];
    clean_spot: [];
    locate: [];
    set_fan_speed: [speed: string];
    send_command: [command: string, params?: Record<string, any>];
}

/**
 * MQTT Vacuum (modern `state` schema only). `state` is one of cleaning/docked/paused/idle/returning/error and is
 * published with `fan_speed` as the JSON state payload. Commands call the matching `on_*` handler; `fan_speed`
 * commands are applied optimistically when no handler is set.
 */
export class TDVacuum extends EntityClass<VacuumState, VacuumServices, VacuumOptions> {
    static domain = "vacuum";

    static { this._defaultAutocleaner(); }

    @observable accessor fan_speed: string | undefined;

    on_start?: () => void;
    on_pause?: () => void;
    on_stop?: () => void;
    on_return_to_base?: () => void;
    on_clean_spot?: () => void;
    on_locate?: () => void;
    on_set_fan_speed?: (speed: string) => void;
    on_send_command?: (command: string, params?: Record<string, any>) => void;

    private get has_fan_speeds() { return !!this.options?.fan_speed_list?.length }

    protected command_keys(): string[] {
        const keys = [...super.command_keys()];
        if (this.has_fan_speeds) keys.push("set_fan_speed");
        if (this.options?.send_command) keys.push("send_command");
        return keys;
    }

    protected getStateFields() {
        return this.has_fan_speeds ? { fan_speed: this.fan_speed } : {};
    }

    protected discovery_data() {
        const dd = super.discovery_data();
        // Modern schema reads the JSON state topic directly
        omitDiscoveryKeys(dd, "value_template");
        Object.assign(dd, discoveryPassOptions(this.options, [
            "supported_features",
            "fan_speed_list",
            "payload_start",
            "payload_pause",
            "payload_stop",
            "payload_return_to_base",
            "payload_clean_spot",
            "payload_locate",
        ]));
        return dd;
    }

    @action
    handle_command(payload: any, key?: string) {
        if (key == "command") {
            const cmd = COMMANDS.find(c => (this.options?.[`payload_${c}` as const] ?? c) == payload);
            if (cmd) this.dispatch(this[`on_${cmd}`], []);
        } else if (key == "set_fan_speed") {
            if (!this.options?.fan_speed_list?.includes(payload)) return;
            this.dispatch(this.on_set_fan_speed, [payload], () => { this.fan_speed = payload });
        } else if (key == "send_command") {
            // Plain command string, or JSON `{"command": ..., ...params}`; malformed JSON is ignored
            const p = parseJsonOrRaw(payload);
            if (typeof p == "string") return this.dispatch(this.on_send_command, [p]);
            if (typeof p?.command != "string") return;
            const { command, ...params } = p;
            this.dispatch(this.on_send_command, [command, params]);
        }
    }
}
