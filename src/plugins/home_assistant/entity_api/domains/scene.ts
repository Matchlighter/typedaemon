
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW } from "./base";

export interface SceneOptions extends EntityOptionsCommon, EntityOptionsCommonW {
}

export class TDScene extends EntityClass<boolean, {}, SceneOptions> {
    static domain = "scene";

    on_pressed: () => void;

    protected async handle_command(payload: any) {
        // if (payload == "ON") // TODO
    }
}
