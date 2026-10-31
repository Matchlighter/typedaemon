import "../../../test/helpers/mock_hypervisor";

import { HyperWrapper } from "../../hypervisor/managed_apps";
import { MqttPlugin, MQTTPluginConfig } from "./plugin";

/** An MqttPlugin with just enough wiring for its config-derived getters (no connections made) */
function plugin(options: Partial<MQTTPluginConfig>, { id = 'broker', haPlugins = {} as Record<string, any> } = {}) {
    const p = Object.create(MqttPlugin.prototype) as MqttPlugin;
    (p as any)[HyperWrapper] = { id, options, hypervisor: { currentConfig: { plugins: haPlugins } } };
    return p;
}

describe('MqttPlugin.statusSummary', () => {
    const discovery = { label: 'Discovery', value: 'prefix homeassistant/' };

    it('lists the discovery prefix and the explicit system topic', () => {
        expect(plugin({ system_topic: 'custom' }).statusSummary).toEqual([discovery, { label: 'System topic', value: 'custom/' }]);
    });

    it('lists only discovery when the system topic is disabled', () => {
        for (const system_topic of [false, ''] as const) {
            expect(plugin({ system_topic }).statusSummary).toEqual([discovery]);
        }
    });

    it('defaults to the td topic for the plugin named "mqtt"', () => {
        expect(plugin({}, { id: 'mqtt' }).statusSummary).toEqual([discovery, { label: 'System topic', value: 'td/' }]);
    });

    it('stays silent by default for other plugins, unless a home_assistant plugin uses it', () => {
        expect(plugin({}).statusSummary).toEqual([discovery]);
        const ha = { ha: { type: 'home_assistant', mqtt_plugin: 'broker' } };
        expect(plugin({}, { haPlugins: ha }).statusSummary).toEqual([discovery, { label: 'System topic', value: 'td/' }]);
    });
});
