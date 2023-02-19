import { createMacro } from "babel-plugin-macros";
import { getVisitor } from "./visit";

export default createMacro(({ references, babel, state, config }) => {
    for (let [key, refs] of Object.entries(references)) {
        refs.forEach(ref => {
            // Transform the decorated method
            if (ref.parentPath.type == "Decorator") {
                const methodPath = ref.parentPath.parentPath;
                const visitor = getVisitor(babel);
                visitor["Method"](methodPath, state);
                methodPath.traverse(visitor, state);
            }
        })
    }
});
