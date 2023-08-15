
import { TDBinarySensor } from "./binary_sensor";
import { TDCustomEntity } from "./custom";
import { TDLight } from "./light";
import { TDSensor } from "./sensor";
import { TDSwitch } from "./switch";

export const domain_entities = {
    switch: TDSwitch,
    light: TDLight,
    sensor: TDSensor,
    binary_sensor: TDBinarySensor,
    custom: TDCustomEntity,
}
