import { createMacro } from "babel-plugin-macros";
import { getVisitor } from "./visit";

export default createMacro(({ references, babel, state, config }) => {
    for (let [key, refs] of Object.entries(references)) {
        refs.forEach(ref => {
            // Allow for parametric macro decorators
            if (ref.parentPath.type == "CallExpression") {
                ref = ref.parentPath;
            }
            // Transform the decorated method
            if (ref.parentPath.type == "Decorator") {
                const methodPath = ref.parentPath.parentPath;
                const visitor = getVisitor(babel);
                // @ts-ignore
                visitor["Method"](methodPath, state);
                methodPath.traverse(visitor, state);
            }
        })
    }
});
