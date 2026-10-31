import { hypervisorHaBaseUrl } from './hypervisor_ha_base_url';

const host = (...plugins: any[]) => ({ listPlugins: () => plugins }) as any;

describe('hypervisorHaBaseUrl', () => {
    it('is the base URL of the home_assistant plugin', () => {
        expect(hypervisorHaBaseUrl(host(
            { options: { type: 'mqtt' }, instance: { haBaseUrl: 'mqtt://nope' } },
            { options: { type: 'home_assistant' }, instance: { haBaseUrl: 'https://ha.example.com' } },
        ))).toBe('https://ha.example.com');
    });

    it('is undefined when none knows one (not connected yet, booting, none configured)', () => {
        expect(hypervisorHaBaseUrl(host({ options: { type: 'home_assistant' }, instance: undefined }, { options: { type: 'home_assistant' }, instance: {} }))).toBeUndefined();
        expect(hypervisorHaBaseUrl(host())).toBeUndefined();
    });
});
