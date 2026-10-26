import { action } from "mobx";
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export interface UpdateOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Device class, e.g. `firmware` */
    device_class?: string;
    /** Software/firmware title */
    title?: string;
    /** Brief release description (max 255 chars) */
    release_summary?: string;
    /** Link to full release notes */
    release_url?: string;
    /** Entity picture URL */
    entity_picture?: string;
    /** Decimal digits for progress display. HA default: 0 */
    display_precision?: number;
    /** If `false`, no command topic is advertised and HA will not offer installation. Default: true */
    installable?: boolean;
}

/** Fields of HA's JSON update state payload (all optional) */
export interface UpdateInfo {
    installed_version?: string;
    latest_version?: string;
    title?: string;
    release_summary?: string;
    release_url?: string;
    entity_picture?: string;
    in_progress?: boolean;
    /** 0-100; `null` resets progress */
    update_percentage?: number | null;
}

const INFO_KEYS = ["latest_version", "title", "release_summary", "release_url", "entity_picture", "in_progress", "update_percentage"] as const;

const PAYLOAD_INSTALL = "INSTALL";

type UpdateServices = {
    install: [];
}

/**
 * MQTT Update. State is the installed version; the remaining `UpdateInfo` fields live in the attributes and are published
 * as top-level fields of the JSON state payload (HA reads them directly). Install requests call `on_install`.
 */
export class TDUpdate extends EntityClass<string | undefined, UpdateServices, UpdateOptions> {
    static domain = "update";

    static { this._defaultAutocleaner(); }

    on_install: () => void;

    /** Set installed version and all other info at once */
    @action
    setInfo(info: UpdateInfo) {
        const { installed_version, ...rest } = info;
        this.setState(installed_version, rest);
    }

    protected command_keys(): string[] {
        return this.options?.installable === false ? [] : super.command_keys();
    }

    protected getStateFields() {
        const f: Record<string, any> = { installed_version: this.state };
        for (const k of INFO_KEYS) if (this.state_attrs?.[k] !== undefined) f[k] = this.state_attrs[k];
        return f;
    }

    protected discovery_data() {
        const dd: any = super.discovery_data();
        // HA parses the JSON state payload (installed_version etc.) directly
        delete dd.value_template;
        if (this.options?.installable === false) {
            delete dd.command_topic;
        } else {
            dd.payload_install = PAYLOAD_INSTALL;
        }
        Object.assign(dd, discoveryPassOptions(this.options, [
            "device_class", "title", "release_summary", "release_url", "entity_picture", "display_precision",
        ]));
        return dd;
    }

    handle_command(payload: any) {
        if (payload == PAYLOAD_INSTALL) this.on_install?.();
    }
}
