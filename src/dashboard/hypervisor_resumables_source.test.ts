import type { AppResumablesSource } from './app_resumables_topic';
import { hypervisorResumablesSource, type ResumablesHost } from './hypervisor_resumables_source';
import type { ResumableRow } from './protocol';

const res = (key: string): ResumableRow => ({ key, status: 'running', type: 'resumable', owner: 'a', method: 'm', params: [], startedAt: 1, restarts: 0 });

describe('hypervisorResumablesSource', () => {
    it('lists every app\'s resumables with app-qualified keys and the original key kept', () => {
        const host = { currentConfig: { apps: { a: {}, b: {}, c: {} } }, watchConfigEntry: () => () => { } } as unknown as ResumablesHost;
        const per: AppResumablesSource = {
            get: id => id === 'c' ? undefined : { resumables: [res('1')], scripts: [] },
            onChange: () => () => { },
        };
        expect(hypervisorResumablesSource(host, per).list()).toEqual([
            { ...res('1'), key: 'a/1', app: 'a', resumableKey: '1' },
            { ...res('1'), key: 'b/1', app: 'b', resumableKey: '1' },
        ]);
    });
});
