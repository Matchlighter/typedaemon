
import { TDBinarySensor } from "./binary_sensor";
import { TDCustomEntity } from "./custom";
import { TDDeviceTracker } from "./device_tracker";
import { TDLight } from "./light";
import { TDSensor } from "./sensor";
import { TDSwitch } from "./switch";

export const domain_entities = {
    device_tracker: TDDeviceTracker,
    switch: TDSwitch,
    light: TDLight,
    sensor: TDSensor,
    binary_sensor: TDBinarySensor,
    custom: TDCustomEntity,
}
