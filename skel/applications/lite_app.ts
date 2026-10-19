
// import { bob } from './test_dep'

/**
 * @dependencies {
 *  mobx: ^4.0
 *  react
 * }
 */

import { test } from "@td"

console.log("APP EXECUTED");

// Exporting a `Config` type gets `config` in `typedaemon_config.ts` type-checked
export type Config = {
    some_option: string;
}

export default class MyApp {
    constructor() {
        console.log("APP CONSTRUCTED")
        // bob()
    }

    async initialize() {
        console.log('initialized')
        const test = await import("./test_dep");
        const react = await import("react");
        console.log("React Version:", react.version)
    }

    shutdown() {
        console.log('shutdown')
    }

    configuration_updated() {

    }
}
