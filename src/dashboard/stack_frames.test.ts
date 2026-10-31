import { parseStackFrames } from './stack_frames';

describe('parseStackFrames', () => {
    const wd = '/wd';

    it('parses named frames, relative to the working directory', () => {
        expect(parseStackFrames(['    at Lights.init (/wd/apps/lights/index.ts:42:17)'], wd))
            .toEqual([{ fn: 'Lights.init', file: 'apps/lights/index.ts', line: 42, col: 17 }]);
    });

    it('parses anonymous frames and strips async', () => {
        expect(parseStackFrames(['    at /wd/a.ts:1:2', '    at async go (/elsewhere/b.js:3:4)'], wd)).toEqual([
            { file: 'a.ts', line: 1, col: 2 },
            { fn: 'go', file: '/elsewhere/b.js', line: 3, col: 4 },
        ]);
    });

    it('drops lines that are not frames (and native frames)', () => {
        expect(parseStackFrames(['    at new Promise (<anonymous>)', 'garbage', ''], wd)).toEqual([]);
    });

    it('strips file:// and query suffixes', () => {
        expect(parseStackFrames(['    at f (file:///wd/x.ts?t=1:5:6)'], wd)).toEqual([{ fn: 'f', file: 'x.ts', line: 5, col: 6 }]);
    });
});
