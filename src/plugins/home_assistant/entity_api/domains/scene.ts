
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW } from "./base";

export interface SceneOptions extends EntityOptionsCommon, EntityOptionsCommonW {
}

export class TDScene extends EntityClass<boolean, {}, SceneOptions> {
    static domain = "scene";

    static { this._defaultAutocleaner(); }

    on_pressed: () => void;

    handle_command(payload: any) {
        if (payload == "ON") this.on_pressed?.();
    }
}
