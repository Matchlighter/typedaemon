import { typeTest } from "../../../../../test/helpers/types";

type TDClimate = import("./climate").TDClimate;
type TDCover = import("./cover").TDCover;
declare const climate: TDClimate;
declare const cover: TDCover;

describe("domain command handler typing", () => {
    typeTest("exposes on_<service> handlers typed from the Services map", () => {
        climate.on_set_target_temperature = (t: number) => { };
        climate.on_set_target_temperature_range = ({ high, low }) => { void [high, low] };
        cover.on_set_position = (p: number) => { };
        cover.on_open = () => { };
    });

    typeTest("rejects unknown or mistyped handlers", () => {
        // @ts-expect-error renamed to on_set_target_humidity
        climate.on_set_humidity = (h: number) => { };
        // @ts-expect-error wrong argument type
        cover.on_set_position = (p: string) => { };
    });
});
