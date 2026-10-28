import * as path from 'path';

const app: any = { operating_directory: '/tmp/app', cleanups: { append: jest.fn() } };
jest.mock('../../hypervisor/current', () => ({ current: { get application() { return app; } } }));
jest.mock('../../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import { ResumableScriptStoreManager, SCRIPT_STATE_FILE } from './resumable';

describe('script state file', () => {
    it('is not the ResumableStore file (they have different shapes)', () => {
        const file = path.basename(new ResumableScriptStoreManager().store_file);
        expect(file).toEqual(SCRIPT_STATE_FILE);
        expect(file).not.toEqual('.resumable_state.json');
    });
});
