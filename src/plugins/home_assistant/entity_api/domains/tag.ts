import { action } from "mobx";
import { RawStatePayload } from "..";
import { EntityClass, EntityOptionsCommon, HATemplate, discoveryPassOptions } from "./base";

export interface TagOptions extends EntityOptionsCommon {
    /** Template that extracts the tag ID from the scan payload. Defaults to the raw payload. */
    value_template?: HATemplate;
}

/** MQTT Tag Scanner. Fire scans via `scan(tagId)`. Discovery-only; has no state, commands or availability. */
export class TDTag extends EntityClass<string, {}, TagOptions> {
    static domain = "tag";

    static { this._defaultAutocleaner(); }

    protected command_keys(): string[] {
        return [];
    }

    protected discovery_data() {
        const base = super.discovery_data();
        // HA's tag schema only accepts topic, value_template and device
        return {
            topic: base.state_topic,
            ...discoveryPassOptions(this.options, ["value_template"]),
            device: base.device,
        };
    }

    @action scan(tag_id: string) {
        this.mqttConn.publish(this.mqtt_state_topic, tag_id);
    }

    protected _publishState(v: RawStatePayload<string>): void {
        // Not Implemented
    }
}
