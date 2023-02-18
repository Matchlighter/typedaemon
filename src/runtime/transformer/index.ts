

import * as babel from "@babel/core"
import { MacroAttachment, attachableMacrosPlugin } from "./attachable_macros";

import { default as resumableMacro } from "./resumable_transformer"

const TDPACKAGE = ['@typedaemon/core', "./src"]

const BABEL_CONFIG: babel.TransformOptions = {
    targets: {
        esmodules: true,
        node: "current",
    },
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'auto' }],
        ['@babel/preset-typescript'],
    ],
    plugins: [
        // TODO Modify plugin macro so that we can attach macros to built-in functions w/o affect the user experience
        ['babel-plugin-macros', {}],
        ["@babel/plugin-proposal-decorators", { version: "2022-03" }],
        [attachableMacrosPlugin, {
            macros: [
                { package: TDPACKAGE, import: "resumable", macro: resumableMacro }
            ] as MacroAttachment[],
        }]
    ],
}

export async function transpileFile(file) {
    const transpiled = await babel.transformFileAsync(file, {
        ...BABEL_CONFIG,
    })

    console.log(transpiled.code)

    return transpiled;
}

