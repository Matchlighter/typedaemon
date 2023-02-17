
import * as babel from "@babel/core"
import regenerator from './resumable_transformer'

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
      'babel-plugin-macros',
      ["@babel/plugin-proposal-decorators", { version: "2022-03" }],
      regenerator,
    ],
}

export class Application {
    constructor(readonly app_id: string, readonly app_root: string) {

    }

    async start() {
        await this.compile();
    }

    async serve() {

    }

    async compile() {
        const transpiled = await babel.transformFileAsync("transpile_test.ts", {
            ...BABEL_CONFIG,
        })
        console.log(transpiled.code)
    }

    async watch_files() {

    }

    private _shutdownRequested = false;
    get shutdownRequest() { return this._shutdownRequested }

    requestShutdown() {
        this._shutdownRequested = true;
    }
}
