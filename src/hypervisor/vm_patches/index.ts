import { logMessage } from "../logging";
import { PATCHES } from "./base";

import "./mobx";
import "./net";

export function patchModule(id: string, mod: any) {
    const patches = PATCHES.filter(p => {
        const m = p.match;
        if (m instanceof RegExp) return m.test(id);
        if (typeof m == 'string') return id == m;
        if (typeof m == 'function') return m(id);
    });

    if (!patches.length) return mod;

    logMessage("debug", `Patching module "${id}"`);

    mod = { ...mod };
    for (let p of patches) {
        mod = p.apply(mod) || mod;
    }

    return mod;
}
