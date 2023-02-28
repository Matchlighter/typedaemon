
import * as babel from "@babel/core"
import { MacroAttachment, attachableMacrosPlugin } from "./attachable_macros";

import { default as resumableMacro } from "./resumable_transformer"

// TODO Set correctly
const TDPACKAGE = ['@typedaemon/core', 'typedaemon', "./src",]

export const APP_BABEL_CONFIG: babel.TransformOptions = {
    targets: {
        esmodules: true,
        node: "current",
    },
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'auto' }],
        ['@babel/preset-typescript'],
    ],
    plugins: [
        ['babel-plugin-macros', {}],
        ["@babel/plugin-proposal-decorators", { version: "2022-03" }],
        [attachableMacrosPlugin, {
            macros: [
                { package: TDPACKAGE, import: "resumable", macro: resumableMacro },
            ] as MacroAttachment[],
        }]
    ],
}

export async function transpileFile(file) {
    const transpiled = await babel.transformFileAsync(file, {
        ...APP_BABEL_CONFIG,
    })

    return transpiled;
}

