import { pickHaBaseUrl } from './base_url';

describe('pickHaBaseUrl', () => {
    const cfg = { external_url: 'https://ha.example.com/', internal_url: 'http://192.168.1.2:8123' };

    it('prefers the external URL, then the internal one, then the configured URL', () => {
        expect(pickHaBaseUrl(cfg, 'http://ha.lan:8123')).toBe('https://ha.example.com');
        expect(pickHaBaseUrl({ ...cfg, external_url: null }, 'http://ha.lan:8123')).toBe('http://192.168.1.2:8123');
        expect(pickHaBaseUrl({ external_url: null, internal_url: null }, 'http://ha.lan:8123/')).toBe('http://ha.lan:8123');
        expect(pickHaBaseUrl(undefined, 'http://ha.lan:8123')).toBe('http://ha.lan:8123');
    });

    it('never offers the Supervisor proxy', () => {
        expect(pickHaBaseUrl(undefined, 'http://supervisor/core')).toBeUndefined();
        expect(pickHaBaseUrl({ external_url: null, internal_url: null }, undefined)).toBeUndefined();
    });
});
