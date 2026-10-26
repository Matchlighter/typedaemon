import { action } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export type AlarmState =
    | "disarmed" | "armed_home" | "armed_away" | "armed_night" | "armed_vacation" | "armed_custom_bypass"
    | "pending" | "triggered" | "arming" | "disarming";

export type AlarmFeature = "arm_home" | "arm_away" | "arm_night" | "arm_vacation" | "arm_custom_bypass" | "trigger";

export interface AlarmControlPanelOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Features to offer in HA. HA default: all */
    supported_features?: AlarmFeature[];
    /** Local code HA validates, or `REMOTE_CODE` / `REMOTE_CODE_TEXT` to receive the entered code in handlers for validation */
    code?: string;
    /** HA default: true */
    code_arm_required?: boolean;
    /** HA default: true */
    code_disarm_required?: boolean;
    /** HA default: true */
    code_trigger_required?: boolean;
}

type AlarmServices = {
    arm_home: [code?: string];
    arm_away: [code?: string];
    arm_night: [code?: string];
    arm_vacation: [code?: string];
    arm_custom_bypass: [code?: string];
    disarm: [code?: string];
    trigger: [code?: string];
}

/** HA default payloads -> [service, optimistic resulting state] */
const ACTIONS = {
    ARM_HOME: ["arm_home", "armed_home"],
    ARM_AWAY: ["arm_away", "armed_away"],
    ARM_NIGHT: ["arm_night", "armed_night"],
    ARM_VACATION: ["arm_vacation", "armed_vacation"],
    ARM_CUSTOM_BYPASS: ["arm_custom_bypass", "armed_custom_bypass"],
    DISARM: ["disarm", "disarmed"],
    TRIGGER: ["trigger", "triggered"],
} as const;

/**
 * MQTT Alarm control panel. HA's `command_template` is used to send `{"action","code"}` JSON so the entered code reaches
 * the handlers. Commands call the matching `on_*` handler (with the code, if any); when a handler isn't set the
 * resulting state is applied optimistically. Transitional states (`arming`, `pending`, ...) are set by the app via `state`.
 */
export class TDAlarmControlPanel extends EntityClass<AlarmState, AlarmServices, AlarmControlPanelOptions> {
    static domain = "alarm_control_panel";

    static { this._defaultAutocleaner(); }

    on_arm_home?: (code?: string) => void;
    on_arm_away?: (code?: string) => void;
    on_arm_night?: (code?: string) => void;
    on_arm_vacation?: (code?: string) => void;
    on_arm_custom_bypass?: (code?: string) => void;
    on_disarm?: (code?: string) => void;
    on_trigger?: (code?: string) => void;

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            command_template: '{"action":"{{ action }}","code":{{ code | tojson }}}',
            ...discoveryPassOptions(this.options ?? {}, [
                "supported_features", "code", "code_arm_required", "code_disarm_required", "code_trigger_required",
            ]),
        });
        for (const k of Object.keys(dd)) if ((dd as any)[k] === undefined) delete (dd as any)[k];
        return dd;
    }

    @action
    handle_command(payload: any) {
        let act: unknown = payload;
        let code: string | undefined;
        if (typeof payload == "string" && payload.trim().startsWith("{")) {
            try { payload = JSON.parse(payload) } catch { return }
        }
        if (payload && typeof payload == "object") {
            act = payload.action;
            code = payload.code || undefined;
        }
        if (typeof act != "string" || !Object.hasOwn(ACTIONS, act)) return;
        const [service, state] = ACTIONS[act as keyof typeof ACTIONS];
        const handler = this[`on_${service}`];
        if (handler) return handler.call(this, code);
        this.state = state;
    }
}
