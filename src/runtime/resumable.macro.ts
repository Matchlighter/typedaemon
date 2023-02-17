import { createMacro } from "babel-plugin-macros";
import { getVisitor } from "./resumable_transformer/visit";

export default createMacro(({ references, babel, state, config }) => {
    const { types: t } = babel;

    references.default.forEach(ref => {
        const decorator_expr: any = ref.container;
        const method_expr = ref.parentPath.parent;

        const visit = getVisitor(babel);
        const visitMethod = visit["Method"];
        visitMethod(ref.parentPath.parentPath, state)
    })
}, {})

