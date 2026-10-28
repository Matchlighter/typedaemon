jest.mock('../../hypervisor/current', () => ({ current: { application: { resumableStore: null } } }));
jest.mock('../../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ResumableStore } from './resumable_store';

describe('ResumableStore.load', () => {
    it('sets aside an old object-shaped state file instead of parsing it as a list', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-resumable-'));
        try {
            const file = path.join(dir, 'state.json');
            fs.writeFileSync(file, JSON.stringify({ some: { legacy: 'state' } }));
            await new ResumableStore({ file }, {}).load();
            expect(fs.existsSync(file)).toBe(false);
            expect(JSON.parse(fs.readFileSync(file + '.legacy', 'utf8'))).toEqual({ some: { legacy: 'state' } });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
