import type { PluginRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { applyPluginsDelta, pluginBadge, sortPlugins } from './plugins_model';

const row = (id: string, over: Partial<PluginRow> = {}): PluginRow => ({ id, type: 'mqtt', state: 'started', since: 1, config: {}, ...over });

describe('plugins model', () => {
    it('folds upserts and removals into the snapshot', () => {
        const next = applyPluginsDelta({ plugins: [row('a'), row('b')] }, { upsert: [row('b', { connection: 'disconnected' }), row('c')], remove: ['a'] });
        expect(next.plugins).toEqual([row('b', { connection: 'disconnected' }), row('c')]);
    });

    it('badges a started plugin by its connection', () => {
        expect(pluginBadge(row('a', { connection: 'reconnecting' }))).toEqual({ kind: 'plugin', state: 'reconnecting' });
        expect(pluginBadge(row('a', { connection: 'listening' }))).toEqual({ kind: 'plugin', state: 'listening' });
    });

    it('badges a started plugin without a connection as started, and any other state by its lifecycle', () => {
        expect(pluginBadge(row('a'))).toEqual({ kind: 'app', state: 'started' });
        expect(pluginBadge(row('a', { state: 'starting', connection: 'connected' }))).toEqual({ kind: 'app', state: 'starting' });
        expect(pluginBadge(row('a', { state: 'stopped' }))).toEqual({ kind: 'app', state: 'stopped' });
    });

    it('sorts by id', () => {
        expect(sortPlugins([row('mqtt'), row('Ha'), row('http')]).map(r => r.id)).toEqual(['Ha', 'http', 'mqtt']);
    });
});

describe('downPlugins', () => {
    const p = (id: string, over: object = {}) => ({ id, type: 'home_assistant', state: 'started', since: 0, connection: 'connected', ...over }) as any;
    it('lists reconnecting, disconnected and not-running plugins only', async () => {
        const { downPlugins } = await import('./plugins_model');
        expect(downPlugins(undefined).size).toBe(0);
        expect([...downPlugins({ plugins: [p('a'), p('b', { connection: 'reconnecting' }), p('c', { connection: 'disconnected' }), p('d', { state: 'stopped' }), p('e', { connection: 'listening' })] })].sort()).toEqual(['b', 'c', 'd']);
    });
});
