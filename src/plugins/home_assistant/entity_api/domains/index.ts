
import { TDAlarmControlPanel } from "./alarm_control_panel";
import { TDBinarySensor } from "./binary_sensor";
import { TDButton } from "./button";
import { TDCamera } from "./camera";
import { TDClimate } from "./climate";
import { TDCover } from "./cover";
import { TDCustomEntity } from "./custom";
import { TDDeviceTracker } from "./device_tracker";
import { TDDeviceTrigger } from "./device_trigger";
import { TDEvent } from "./event";
import { TDFan } from "./fan";
import { TDHumidifier } from "./humidifier";
import { TDImage } from "./image";
import { TDLight } from "./light";
import { TDNumber } from "./number";
import { TDScene } from "./scene";
import { TDSiren } from "./siren";
import { TDStreamCamera } from "./stream_camera";
import { TDSelect } from "./select";
import { TDSensor } from "./sensor";
import { TDSwitch } from "./switch";
import { TDTag } from "./tag";
import { TDText } from "./text";
import { TDUpdate } from "./update";
import { TDVacuum } from "./vacuum";
import { TDWaterHeater } from "./water_heater";

export const domain_entities = {
    alarm_control_panel: TDAlarmControlPanel,
    binary_sensor: TDBinarySensor,
    button: TDButton,
    camera: TDCamera,
    climate: TDClimate,
    cover: TDCover,
    custom: TDCustomEntity,
    device_tracker: TDDeviceTracker,
    device_trigger: TDDeviceTrigger,
    event: TDEvent,
    fan: TDFan,
    humidifier: TDHumidifier,
    image: TDImage,
    light: TDLight,
    number: TDNumber,
    scene: TDScene,
    select: TDSelect,
    siren: TDSiren,
    sensor: TDSensor,
    /** HA `camera` with a live stream, via the companion integration (not MQTT). Separate key: `camera` is the MQTT snapshot camera */
    stream_camera: TDStreamCamera,
    switch: TDSwitch,
    tag: TDTag,
    text: TDText,
    update: TDUpdate,
    vacuum: TDVacuum,
    water_heater: TDWaterHeater,
}
