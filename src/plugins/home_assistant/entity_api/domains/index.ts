
import { TDBinarySensor } from "./binary_sensor";
import { TDButton } from "./button";
import { TDCustomEntity } from "./custom";
import { TDDeviceTracker } from "./device_tracker";
import { TDDeviceTrigger } from "./device_trigger";
import { TDEvent } from "./event";
import { TDImage } from "./image";
import { TDLight } from "./light";
import { TDNumber } from "./number";
import { TDScene } from "./scene";
import { TDSelect } from "./select";
import { TDSensor } from "./sensor";
import { TDSwitch } from "./switch";
import { TDText } from "./text";

export const domain_entities = {
    binary_sensor: TDBinarySensor,
    button: TDButton,
    custom: TDCustomEntity,
    device_tracker: TDDeviceTracker,
    device_trigger: TDDeviceTrigger,
    event: TDEvent,
    image: TDImage,
    light: TDLight,
    number:TDNumber,
    scene: TDScene,
    select:TDSelect,
    sensor: TDSensor,
    switch: TDSwitch,
    text:TDText,
}
