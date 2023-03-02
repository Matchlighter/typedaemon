
import * as mobx from 'mobx'
import { hasSideEffects } from '../../../src/app_transformer/resumable_transformer/meta'
import { current } from '../../../src/hypervisor/current'
import { HyperWrapper } from '../../../src/hypervisor/managed_apps'
import { bob } from './test_dep'
import { ha, mqtt } from "@td"

export default class MyApp {
    async initialize() {
        // mqtt.publish("bob/boberts", { a: 1 })
        // mqtt.subscribe("#", console.log)
        // console.log('BIG APP')
        // const react = await import("react");
        // console.log(react.version)
        // bob();
        // console.log(global['IS_TYPEDAEMON_VM'])
        console.log(ha.states['input_select.test'])
    }

    // @mqtt.subscribe("tele/tasmota_A97004/#")
    // mqtt_test(topic, payload) {
    //     console.log(topic, payload)
    // }

    shutdown() {
    }

    configuration_updated() { }
}
