
import * as mobx from 'mobx'
import { bob } from './test_dep'
import { ha, mqtt } from "@td"

export default class MyApp {
    async initialize() {
        mqtt.publish("bob/boberts", { a: 1 })
        mqtt.subscribe("#", console.log)
        console.log('BIG APP')
        console.log(ha.states['input_select.test'])
    }

    @mqtt.subscribe("tele/tasmota_A97004/#")
    mqtt_test(topic, payload) {
        console.log(topic, payload)
    }

    shutdown() {
    }

    configuration_updated() { }
}
