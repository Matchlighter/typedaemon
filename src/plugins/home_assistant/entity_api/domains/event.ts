
import { action } from "mobx";
import { RawStatePayload } from "..";
import { EntityClass, EntityOptionsCommon, discoveryPassOptions } from "./base";

type EventDeviceClass = string;

export interface EventOptions extends EntityOptionsCommon {
    /** The type/class of the event to set the icon in the frontend. The device_class can be null. */
    device_class?: EventDeviceClass;

    /** A list of valid event_type strings. */
    event_types: string[];
}

export class TDEvent extends EntityClass<boolean, {}, EventOptions> {
    static domain = "event"; // TODO Not sure if Events work via Discovery

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "device_class",
                "event_types",
            ]),
        })
        return dd;
    }

    @action fire(event: string) {
        this.mqttConn.publish(this.mqtt_state_topic, event);
    }

    protected _publishState(v: RawStatePayload<boolean>): void {
        // Not Implemented
    }
}
