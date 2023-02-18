import { createMacro } from "babel-plugin-macros";
import { ensureImport } from "@matchlighter/common_library/cjs/macro/helpers";
import { getVisitor } from "./resumable_transformer/visit";
import type { resumable } from "./resumable_runtime"

export default createMacro(({ references, babel, state, config }) => {
    const { types: t } = babel;

    references.default.forEach(ref => {
        // Rename to the non-macro version
        ref.replaceWith(t.identifier("_internal_resumable"))

        // Transform the decorated method
        if (ref.parentPath.type == "Decorator") {
            const methodPath = ref.parentPath.parentPath;
            const visitor = getVisitor(babel);
            visitor["Method"](methodPath, state);
            methodPath.traverse(visitor, state);
        }

        // Ensure the new internal method is imported
        const program = ref.scope.getProgramParent().path;
        ensureImport(t, program, '_internal_resumable', '@typedaemon/core');
    })
}, {}) as typeof resumable;

