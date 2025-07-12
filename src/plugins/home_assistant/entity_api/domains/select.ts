
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, discoveryPassOptions } from "./base";

export interface SelectOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** List of options that can be selected. An empty list or a list with a single item is allowed. */
    options: string[];
}

export class TDSelect extends EntityClass<string, {}, SelectOptions> {
    static domain = "select";

    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "options",
            ]),
        })
        return dd;
    }

    handle_command(payload: any) {
        this.state = payload;
    }
}
