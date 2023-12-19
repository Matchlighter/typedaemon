
import { RawStatePayload } from "..";
import { EntityClass, EntityOptionsCommon, HATemplate, discoveryPassOptions } from "./base";

export interface ImageOptions extends EntityOptionsCommon {
    // /** The content type of and image data message received on image_topic.This option cannot be used with the url_topic because the content type is derived when downloading the image. */
    // content_type?: string;

    // /** The encoding of the image payloads received. Set to "b64" to enable base64 decoding of image payload. If not set, the image payload must be raw binary data. */
    // image_encoding?: null | "b64";

    // /** Defines a template to extract the image URL from a message received at url_topic. */
    // url_template?: HATemplate;

    // /** The MQTT topic to subscribe to receive the image payload of the image to be downloaded. Ensure the content_type type option is set to the corresponding content type. This option cannot be used together with the url_topic option. But at least one of these option is required. */
    // image_topic?: string;

    // /** The MQTT topic to subscribe to receive an image URL. A url_template option can extract the URL from the message. The content_type will be derived from the image when downloaded. This option cannot be used together with the image_topic option, but at least one of these options is required. */
    // url_topic?: string;
}

export class TDImage extends EntityClass<string, {}, ImageOptions> {
    static domain = "image";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        // @ts-ignore
        dd.url_topic = dd.state_topic;
        delete dd.state_topic;
        return dd;
    }

    protected _publishState(v: RawStatePayload<string>): void {
        // TODO Make the image accessible and publish the URL (not the image directly)
        super._publishState(v);
    }
}
