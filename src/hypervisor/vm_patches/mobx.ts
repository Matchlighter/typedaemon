
import { appmobx } from "../../plugins/mobx";
import { registerPatch } from "./base";

// Supply a patched MobX that will automatically add Reaction disposers to the cleanups
registerPatch(id => id?.includes("node_modules/mobx/dist/"), (mod) => {
    return appmobx;
});
