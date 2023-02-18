const p = require('path')
const resolve = require('resolve')
// const printAST = require('ast-pretty-print')

export interface MacroAttachment {
    package: string | string[] | RegExp;
    import: string | RegExp;
    macro: any;
    remove_import?: boolean;
}

function attachableMacrosPlugin(
    babel,
    {
        macros = [],
        ...options
    }: { macros: MacroAttachment[] },
) {
    return {
        name: 'attached_macros',
        visitor: {
            Program(progPath, state) {
                progPath.traverse({
                    ImportDeclaration(path) {
                        const importName = path?.node?.source?.value;
                        const source = path.node.source.value

                        const imports = [];
                        for (let s of path.node.specifiers) {
                            if (!s.local || !s.imported) return;

                            imports.push({
                                localName: s.local?.name,
                                importedName: s.type === 'ImportDefaultSpecifier' ? 'default' : s.imported?.name,
                            })
                        }

                        for (let macroDef of macros) {
                            const mdpkg = macroDef.package;
                            if (typeof mdpkg == 'string') {
                                if (mdpkg != importName) continue;
                            } else if (Array.isArray(mdpkg)) {
                                if (!mdpkg.includes(importName)) continue;
                            } else if (mdpkg instanceof RegExp) {
                                if (!mdpkg.test(importName)) continue;
                            }

                            const matched_imports = [];
                            const mdimp = macroDef.import;
                            for (let imp of imports) {
                                const impname = imp.localName;
                                if (typeof mdimp == 'string') {
                                    if (mdimp != impname) continue;
                                } else if (Array.isArray(mdimp)) {
                                    if (!mdimp.includes(impname)) continue;
                                } else if (mdimp instanceof RegExp) {
                                    if (!mdimp.test(impname)) continue;
                                }
                                matched_imports.push(imp);
                            }

                            applyMacros({
                                path,
                                imports: matched_imports,
                                source,
                                state,
                                babel,
                                macro: macroDef.macro,
                            })

                            if (macroDef.remove_import) {
                                path.remove()
                            }
                        }
                    },
                    // VariableDeclaration(path) {
                    //     const isMacros = child =>
                    //         looksLike(child, {
                    //             node: {
                    //                 init: {
                    //                     callee: {
                    //                         type: 'Identifier',
                    //                         name: 'require',
                    //                     },
                    //                     arguments: args =>
                    //                         args.length === 1 && isMacrosName(args[0].value),
                    //                 },
                    //             },
                    //         })

                    //     path
                    //         .get('declarations')
                    //         .filter(isMacros)
                    //         .forEach(child => {
                    //             const imports = child.node.id.name
                    //                 ? [{ localName: child.node.id.name, importedName: 'default' }]
                    //                 : child.node.id.properties.map(property => ({
                    //                     localName: property.value.name,
                    //                     importedName: property.key.name,
                    //                 }))

                    //             const call = child.get('init')
                    //             const source = call.node.arguments[0].value
                    //             const result = applyMacros({
                    //                 path: call,
                    //                 imports,
                    //                 source,
                    //                 state,
                    //                 babel,
                    //                 interopRequire,
                    //                 resolvePath,
                    //                 options,
                    //             })

                    //             if (!result || !result.keepImports) {
                    //                 child.remove()
                    //             }
                    //         })
                    // },
                })
            },
        },
    }
}

function applyMacros({
    path,
    imports,
    source,
    state,
    babel,
    macro,
}) {
    const {
        file: {
            opts: { filename = '' },
        },
    } = state
    let hasReferences = false
    const referencePathsByImportName = imports.reduce(
        (byName, { importedName, localName }) => {
            const binding = path.scope.getBinding(localName)

            byName[importedName] = binding.referencePaths
            hasReferences = hasReferences || Boolean(byName[importedName].length)

            return byName
        },
        {},
    )

    let result
    try {
        /**
         * Other plugins that run before babel-plugin-macros might use path.replace, where a path is
         * put into its own replacement. Apparently babel does not update the scope after such
         * an operation. As a remedy, the whole scope is traversed again with an empty "Identifier"
         * visitor - this makes the problem go away.
         *
         * See: https://github.com/kentcdodds/import-all.macro/issues/7
         */
        state.file.scope.path.traverse({
            Identifier() { },
        })

        result = macro({
            references: referencePathsByImportName,
            source,
            state,
            babel,
            isBabelMacrosCall: true,
        })
    } catch (error) {
        if (error.name === 'MacroError') {
            throw error
        }
        error.message = `${source}: ${error.message}`
        throw error
    }
    return result
}


export { attachableMacrosPlugin }
