import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorPanel, errorText, isFrameworkFrame } from './ErrorPanel';

const frames = [
    { fn: 'Lights.init', file: 'apps/lights/index.ts', line: 4, col: 5 },
    { file: 'apps/lights/util.ts', line: 9 },
];

describe('ErrorPanel', () => {
    it('shows the phase, message and source-mapped frames', () => {
        const out = renderToString(<ErrorPanel phase="starting" message="boom" frames={frames} />);
        expect(out).toContain('role="alert"');
        expect(out).toMatch(/Failed during <span class="mono">starting<\/span>/);
        expect(out).toContain('boom');
        expect(out).toContain('Lights.init');
        expect(out).toContain('apps/lights/index.ts:4:5');
        expect(out).toContain('apps/lights/util.ts:9');
    });

    it('omits the frames list when there are none', () => {
        expect(renderToString(<ErrorPanel phase="compiling" message="x" frames={[]} />)).not.toContain('<ol');
    });

    it('links to the logs when given', () => {
        expect(renderToString(<ErrorPanel phase="x" message="y" frames={[]} logsHref="#/apps/a/logs" />)).toContain('href="#/apps/a/logs"');
    });

    it('lists the plugins with their connection state, each linking to its page', () => {
        const out = renderToString(<ErrorPanel phase="starting" message="x" frames={[]}
            plugins={[{ id: 'ha', type: 'home_assistant', state: 'started', connection: 'disconnected' }, { id: 'mqtt', type: 'mqtt', state: 'started', connection: 'connected' }]} />);
        expect(out).toContain('errpanel-plugins');
        expect(out).toContain('href="#/plugins/ha"');
        expect(out).toContain('disconnected');
        expect(out).toContain('connected');
        expect(out).toContain('Dependencies at failure');
        expect(out).not.toContain('Plugins were healthy');
    });

    it('has no plugins card without plugins', () => {
        expect(renderToString(<ErrorPanel phase="x" message="y" frames={[]} plugins={[]} />)).not.toContain('errpanel-plugins');
        expect(renderToString(<ErrorPanel phase="x" message="y" frames={[]} />)).not.toContain('errpanel-plugins');
    });

    it('lists the cross-app calls blocked by this app, each linking to its caller', () => {
        const out = renderToString(<ErrorPanel phase="starting" message="x" frames={[]}
            blockedCalls={[{ source: 'lights', target: 'door', method: 'open' }, { source: 'alarm', target: 'door', method: 'arm' }]} />);
        expect(out).toContain('errpanel-blocked');
        expect(out).toContain('Blocked by this');
        expect(out).toContain('href="#/apps/lights"');
        expect(out).toContain('door.open');
        expect(out).toContain('href="#/apps/alarm"');
        expect(out).toContain('2 cross-app calls pending');
    });

    it('says the plugins were healthy only when every one is up', () => {
        const ok = { id: 'mqtt', type: 'mqtt', state: 'started' as const, connection: 'connected' as const };
        expect(renderToString(<ErrorPanel phase="x" message="y" frames={[]} plugins={[ok]} />)).toContain('Plugins were healthy');
        expect(renderToString(<ErrorPanel phase="x" message="y" frames={[]} plugins={[ok, { ...ok, id: 'ha', connection: 'disconnected' }]} />)).not.toContain('Plugins were healthy');
    });

    it('says when a blocked call times out', () => {
        const out = renderToString(<ErrorPanel phase="x" message="y" frames={[]} blockedCalls={[{ source: 'a', target: 'b', method: 'm', timeoutAt: Date.now() + 3_600_000 }]} />);
        expect(out).toContain('1 cross-app call pending');
        expect(out).toContain('times out');
    });

    it('counts framework frames hidden outside the full stack', () => {
        const fw = [{ file: '/srv/td/app_instance.ts', line: 1 }, { file: 'node:internal/x', line: 2 }, { file: 'a/node_modules/b/i.js', line: 3 }];
        expect(fw.every(isFrameworkFrame)).toBe(true);
        expect(isFrameworkFrame({ file: 'apps/lights/index.ts', line: 1 })).toBe(false);
        const out = renderToString(<ErrorPanel phase="starting" message="x" frames={[...frames, ...fw]} />);
        expect(out).toContain('3 framework frames hidden');
        expect(out).toContain('Full stack (5 frames)');
    });

    it('has no blocked card without blocked calls', () => {
        expect(renderToString(<ErrorPanel phase="x" message="y" frames={[]} blockedCalls={[]} />)).not.toContain('errpanel-blocked');
    });

    it('errorText is the copyable plain-text form', () => {
        expect(errorText('starting', 'boom', frames)).toBe(
            'Failed during starting: boom\n    at Lights.init (apps/lights/index.ts:4:5)\n    at apps/lights/util.ts:9');
    });

    const codeFrame = { file: 'apps/lights/index.ts', line: 42, col: 17, lines: [
        { n: 41, text: 'const door = this.ha.entity();' }, { n: 42, text: "if (door.previous.state === 'on') {" }, { n: 43, text: '  await notify();' }] };

    it('shows a code frame with line numbers, the hit line marked and a caret under the column', () => {
        const out = renderToString(<ErrorPanel phase="starting" message="x" frames={frames} codeFrame={codeFrame} />);
        expect(out).toContain('errpanel-code');
        expect(out).toMatch(/<div class="ln hit"[^>]*><span class="n">42<\/span>/);
        expect(out).toContain('const door = this.ha.entity();');
        expect(out).toContain('ln caret');
        expect(out).toContain(' '.repeat(16) + '^');
    });

    it('puts the full stack behind a disclosure and the top frame in view', () => {
        const out = renderToString(<ErrorPanel phase="starting" message="x" frames={frames} />);
        expect(out).toContain('<details');
        expect(out).toContain('Full stack (2 frames)');
        expect(out).toContain('errpanel-top');
    });
});
