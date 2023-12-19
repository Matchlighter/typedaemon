
import { EntityClass, EntityOptionsCommon, HATemplate, discoveryPassOptions } from "./base";

export interface DeviceTrackerOptions extends EntityOptionsCommon {
    // /** The payload that represents the available state. */
    // payload_available?: string;

    // /** The payload value that represents the ‘home’ state for the device. */
    // payload_home?: string;

    // /** The payload that represents the unavailable state. */
    // payload_not_available?: string;

    // /** The payload value that represents the ‘not_home’ state for the device. */
    // payload_not_home?: string;

    // /** The payload value that will have the device’s location automatically derived from Home Assistant’s zones. */
    // payload_reset?: string;

    /** Attribute of a device tracker that affects state when being used to track a person. Valid options are gps, router, bluetooth, or bluetooth_le. */
    source_type?: "gps" | "router" | "bluetooth" | "bluetooth_le";
}

export class TDDeviceTracker extends EntityClass<"home" | "not_home" | "by_gps", {}, DeviceTrackerOptions> {
    static domain = "device_tracker";

    static { this._defaultAutocleaner(); }

    // TODO Support GPS Attrs
    // {
    //     "latitude": 32.87336,
    //     "longitude": -117.22743,
    //     "gps_accuracy": 1.2
    // }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "source_type",
            ]),

            payload_reset: "by_gps",
        })
        return dd;
    }
}
