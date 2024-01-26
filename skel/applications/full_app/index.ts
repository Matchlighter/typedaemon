
import type { HassEntity } from 'home-assistant-js-websocket'

import { Application, get_app, ha, mqtt, persistence, resumable, schedule, sleep, lifecycle } from "@td"
import * as mobx from 'mobx'

// TypeDaemon uses MobX to make things automatically react when values change
// Read more about MobX here: https://mobx.js.org/README.html

export default class MyApp extends Application {
    // Make a property automatically persist to disk, surviving restarts
    @persistence.property
    accessor pvalue = 1;

    // Perform logic when the application starts
    @lifecycle.on_started
    async handle_app_started() {
        // Publish something via MQTT. Objects will be automatically converted to JSON strings
        mqtt.publish("bob/boberts", { a: 1 })

        // Imperatively subscribe to an MQTT topic
        mqtt.subscribe("#", console.log)

        // Get the state of some entity in Home Assistant
        console.log(ha.states['input_select.test'])

        // Mobx autorun can be used to automatically run JS when an observed value changes
        mobx.autorun(() => {
            console.log("Input 'test' changed:", ha.states['input_select.test'])
        });
    }

    // Advanced: You can also/alternatively provide an initialize method.
    // It is executed _before_ the application is considered started and _before_ TypeDaemon @annotations are fully applied, so
    // you should be wary and understand that @annotations may not yet be fully setup.
    async initialize() {}

    // Create a Button Helper in Home Assistant that will call the method when it is pressed
    @ha.button({ id: "td_button", name: "TD Button" })
    btn() {
        console.log("PRESSED")
    }

    // Create a Dropdown Helper in Home Assistant, syncing (2-way) it's state to `input_select_value`.
    @ha.input.select(['A', 'B', 'C'], { name: "TD Test" })
    accessor input_select_value = 'B';

    // Create a Sensor entity in Home Assistant.
    // MobX @computed is automatically applied, so any changes to observed MobX observables - in this
    // case just `input_select_value` (which has MobX @observable automatically applied by `@ha.input.select`) - will
    // automatically update the sensor value in Home Assistant
    @ha.entity.sensor({ id: "test", name: "TD Test Sensor" })
    get test_sensor() {
        return this.input_select_value?.charCodeAt(0);
    }

    // Run some logic when a Home Assistant entity changes
    @ha.subscribe_state(["binary_sensor.front_door", "binary_sensor.back_door", "binary_sensor.garage_side_door"])
    handle_door_state(new_state: HassEntity, old_state, entity: string) {}

    // Do something everyday at 4:30AM (Hover over the second `schedule` to see more accepted date formats)
    @schedule.schedule("4:30 AM")
    scheduled_task() { }

    // Subscribe to a MQTT topic or wildcard
    @mqtt.subscribe("tele/tasmota_A97004/#")
    mqtt_test(topic: string, payload: any) {
        console.log(topic, payload)
    }

    // Mark an async method as a resumable automation
    // (Hover over @resumable to see more info)
    @resumable
    async some_resumable(x) {
        let y = 5

        // Resumable methods can safely call other Resumable methods
        await this.some_other_resumable(2);

        // ...including from other applications
        await get_app("other_app_id").callMethod("method_in_other_app", [1, 2, 3]);

        // Sleep/wait for 5000ms/5s
        const mslate = await sleep(5000)
        console.log("SLEEP END", mslate / 1000, x, y)
    }

    @resumable
    async some_other_resumable(x) {
        console.log("SLEEP 2 START", x)
        const mslate = await sleep(5000)
        console.log("SLEEP 2 END", mslate / 1000, x)
    }

    // Perform logic when the application shutsdown
    shutdown() { }

    // Advanced: Perform custom logic when the configuration changes instead of the automatically restarting the app
    configuration_updated() { }
}
