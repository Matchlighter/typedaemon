import { redactConfig } from './redact_config';

describe('redactConfig', () => {
    it('hides secret-looking keys at any depth, leaving the rest', () => {
        expect(redactConfig({ url: 'x', password: 'p', nested: { api_key: 'k', list: [{ token: 't', ok: 1 }] } }))
            .toEqual({ url: 'x', password: '***', nested: { api_key: '***', list: [{ token: '***', ok: 1 }] } });
    });
});
