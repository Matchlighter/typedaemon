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

    describe.each([['null', 'null'], ['a string', '"x"'], ['an empty object', '{}'], ['a number', '3']])('a state file that is %s', (_, json) => {
        it('is set aside, nothing resumes, and saving an empty store does not recreate it', async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-resumable-'));
            try {
                const file = path.join(dir, 'state.json');
                fs.writeFileSync(file, json);
                const store = new ResumableStore({ file }, {});
                expect(await store.load()).toEqual([]);
                expect(fs.existsSync(file)).toBe(false);
                expect(fs.readFileSync(file + '.legacy', 'utf8')).toBe(json);
                expect(store.size).toBe(0);
                await store.save();
                expect(fs.existsSync(file)).toBe(false);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    it('replaces an older .legacy file left by a previous start', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-resumable-'));
        try {
            const file = path.join(dir, 'state.json');
            fs.writeFileSync(file + '.legacy', 'old');
            fs.writeFileSync(file, JSON.stringify({ newer: 1 }));
            await new ResumableStore({ file }, {}).load();
            expect(JSON.parse(fs.readFileSync(file + '.legacy', 'utf8'))).toEqual({ newer: 1 });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an empty list is a valid state: it resumes nothing and is consumed', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-resumable-'));
        try {
            const file = path.join(dir, 'state.json');
            fs.writeFileSync(file, '[]');
            expect(await new ResumableStore({ file }, {}).load()).toEqual([]);
            expect(fs.existsSync(file)).toBe(false);
            expect(fs.existsSync(file + '.legacy')).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
