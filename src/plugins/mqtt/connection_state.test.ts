import { aggregateMqttState } from './connection_state';

const c = (over: any) => ({ connected: false, reconnecting: false, ...over });

describe('aggregateMqttState', () => {
    it('is undefined without clients', () => expect(aggregateMqttState([])).toBeUndefined());
    it('is connected when every client is', () => expect(aggregateMqttState([c({ connected: true }), c({ connected: true })])).toBe('connected'));
    it('is reconnecting when any client is trying again', () => expect(aggregateMqttState([c({ connected: true }), c({ reconnecting: true })])).toBe('reconnecting'));
    it('is disconnected when a client is down and not retrying', () => expect(aggregateMqttState([c({ connected: true }), c({})])).toBe('disconnected'));
});
