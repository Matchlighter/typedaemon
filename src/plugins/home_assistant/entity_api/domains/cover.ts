import { action, observable } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export type CoverState = "open" | "opening" | "closed" | "closing" | "stopped";

export interface CoverOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Device class (e.g. `garage`, `blind`, `shade`); controls icon and open/close arrows */
    device_class?: string;

    /** Enable position reporting (`position`) and `set_position` commands */
    position?: boolean;
    /** Position value meaning fully open. HA default: 100 */
    position_open?: number;
    /** Position value meaning fully closed. HA default: 0 */
    position_closed?: number;

    /** Enable tilt reporting (`tilt`) and tilt commands */
    tilt?: boolean;
    /** Minimum tilt value. HA default: 0 */
    tilt_min?: number;
    /** Maximum tilt value. HA default: 100 */
    tilt_max?: number;
    /** Tilt value HA sends for close-tilt. HA default: 0 */
    tilt_closed_value?: number;
    /** Tilt value HA sends for open-tilt. HA default: 100 */
    tilt_opened_value?: number;
}

type CoverServices = {
    open_cover: [];
    close_cover: [];
    stop_cover: [];
    set_cover_position: [position: number];
    set_cover_tilt_position: [tilt: number];
    stop_cover_tilt: [];
}

/** HA's default `payload_open`/`payload_close`/`payload_stop` */
const ACTIONS = {
    OPEN: { handler: "on_open", state: "open" },
    CLOSE: { handler: "on_close", state: "closed" },
    STOP: { handler: "on_stop", state: "stopped" },
} as const;

/** HA's default `payload_stop_tilt` (sent on the tilt command topic) */
const PAYLOAD_STOP_TILT = "stop";

/**
 * MQTT Cover. Commands from HA call the matching `on_*` handler; when a handler isn't set the command is applied
 * optimistically (state/position updated directly).
 * `position` and `tilt` are published as fields of the JSON state payload, in the raw `position_*`/`tilt_*` ranges.
 */
export class TDCover extends EntityClass<CoverState, CoverServices, CoverOptions> {
    static domain = "cover";

    static { this._defaultAutocleaner(); }

    @observable accessor position: number | undefined;
    @observable accessor tilt: number | undefined;

    on_open?: () => void;
    on_close?: () => void;
    on_stop?: () => void;
    on_set_position?: (position: number) => void;
    on_set_tilt?: (tilt: number) => void;
    on_stop_tilt?: () => void;

    private get position_open() { return this.options?.position_open ?? 100 }
    private get position_closed() { return this.options?.position_closed ?? 0 }

    protected command_keys(): string[] {
        const keys = super.command_keys();
        if (this.options?.position) keys.push("set_position");
        if (this.options?.tilt) keys.push("tilt_command");
        return keys;
    }

    protected getStateFields() {
        const f: Record<string, any> = {};
        if (this.options?.position) f.position = this.position;
        if (this.options?.tilt) f.tilt = this.tilt;
        return f;
    }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, discoveryPassOptions(this.options, ["device_class"]));
        if (this.options?.position) {
            Object.assign(dd, {
                position_topic: this.mqtt_state_topic,
                position_template: "{{ value_json.position }}",
                ...discoveryPassOptions(this.options, ["position_open", "position_closed"]),
            });
        }
        if (this.options?.tilt) {
            Object.assign(dd, {
                tilt_status_topic: this.mqtt_state_topic,
                tilt_status_template: "{{ value_json.tilt }}",
                ...discoveryPassOptions(this.options, ["tilt_min", "tilt_max", "tilt_closed_value", "tilt_opened_value"]),
            });
        }
        return dd;
    }

    @action
    handle_command(payload: any, key?: string) {
        if (key == "command") {
            const act = ACTIONS[payload as keyof typeof ACTIONS];
            if (!act) return;
            const handler = this[act.handler];
            if (handler) return handler.call(this);
            this.state = act.state;
            if (this.options?.position && act.state != "stopped") {
                this.position = act.state == "open" ? this.position_open : this.position_closed;
            }
        } else if (key == "set_position") {
            const pos = parseFloat(payload);
            if (isNaN(pos)) return;
            if (this.on_set_position) return this.on_set_position(pos);
            this.position = pos;
            this.state = pos == this.position_closed ? "closed" : "open";
        } else if (key == "tilt_command") {
            if (payload == PAYLOAD_STOP_TILT) return this.on_stop_tilt?.();
            const tilt = parseFloat(payload);
            if (isNaN(tilt)) return;
            if (this.on_set_tilt) return this.on_set_tilt(tilt);
            this.tilt = tilt;
        }
    }
}
