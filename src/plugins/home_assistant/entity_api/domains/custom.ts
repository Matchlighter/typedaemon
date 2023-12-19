
import { EntityClass, EntityOptionsCommon } from "./base";

export interface CustomEntityOptions extends EntityOptionsCommon {
    discovery_data?: Record<string, any> | ((entity: TDCustomEntity<any>) => Record<string, any>)
}

export class TDCustomEntity<T> extends EntityClass<T, {}, CustomEntityOptions> {
    static { this._defaultAutocleaner(); }

    protected discovery_data() {
        const dd = super.discovery_data();

        let gdd = this.options.discovery_data;
        if (typeof gdd == 'function') gdd = gdd(this);
        Object.assign(dd, gdd)

        return dd;
    }
}
