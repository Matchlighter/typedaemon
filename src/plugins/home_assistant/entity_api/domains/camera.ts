import { RawStatePayload } from "..";
import { EntityClass, EntityOptionsCommon } from "./base";

export interface CameraOptions extends EntityOptionsCommon {
    /** Set to "b64" if the state is a base64-encoded string. If unset, the state must be raw image bytes. */
    image_encoding?: "b64";
}

/** Raw image file contents (e.g. JPEG), or a base64 string when `image_encoding: "b64"` */
export type CameraImage = Buffer | Uint8Array | string;

/**
 * MQTT Camera. State is the current image; it's published raw (not JSON) to a dedicated image topic.
 * State attributes are published as JSON on the regular state topic.
 */
export class TDCamera extends EntityClass<CameraImage | undefined, {}, CameraOptions> {
    static domain = "camera";

    static { this._defaultAutocleaner(); }

    protected get mqtt_image_topic() {
        return `${this.mqtt_topic}/image`;
    }

    protected command_keys(): string[] {
        return [];
    }

    protected discovery_data() {
        const dd = super.discovery_data() as Record<string, any>;
        // Camera's `topic` carries image bytes; HA has no state/command topics for it
        delete dd.state_topic;
        delete dd.value_template;
        delete dd.command_topic;
        dd.topic = this.mqtt_image_topic;
        if (this.options?.image_encoding) dd.image_encoding = this.options.image_encoding;
        return dd;
    }

    protected _publishState(v: RawStatePayload<CameraImage | undefined>): void {
        const { state, ...rest } = v;
        if (state != null) {
            this.mqttConn.publish(this.mqtt_image_topic, state as any, { retain: true });
        }
        // Attributes only; the image never goes through the JSON topic
        super._publishState(rest as any);
    }

    async _destroy() {
        await super._destroy();
        this.mqttConn.publish(this.mqtt_image_topic, null as any, { retain: true });
    }
}
