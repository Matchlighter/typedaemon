import { inspect, InspectOptionsStylized } from "util";
import { toJS } from "mobx";

import { HAEntity } from "@matchlighter/ha-mobx-store/model/entity";

// TODO Move upstream into @matchlighter/ha-mobx-store.
//   HAEntity holds a back-reference to the whole store and keeps its observable fields in private accessor storage,
//   so default inspection dumps the store but omits `state`/`attributes`. Present it as the HassEntity it mirrors.
Object.defineProperty(HAEntity.prototype, inspect.custom, {
    value: function (this: HAEntity, depth: number, options: InspectOptionsStylized, inspect_: typeof inspect) {
        const name = options.stylize(this.constructor.name, 'special');
        if (depth < 0) return `[${name} ${this.entity_id}]`;

        const { entity_id, state, last_changed, last_updated, context } = this;
        const plain = { entity_id, state, attributes: toJS(this.attributes), last_changed, last_updated, context };
        return `${name} ${inspect_(plain, { ...options, depth })}`;
    },
});
