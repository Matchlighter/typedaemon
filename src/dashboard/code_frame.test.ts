import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCodeFrame } from './code_frame';

const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cf-'));
fs.writeFileSync(path.join(wd, 'a.ts'), ['one', 'two', 'three', 'four', 'five'].join('\n'));

describe('readCodeFrame', () => {
    it('returns the hit line with one line of context either side', () => {
        expect(readCodeFrame({ file: 'a.ts', line: 3, col: 2 }, wd)).toEqual({
            file: 'a.ts', line: 3, col: 2,
            lines: [{ n: 2, text: 'two' }, { n: 3, text: 'three' }, { n: 4, text: 'four' }],
        });
    });

    it('clamps at file start and end', () => {
        expect(readCodeFrame({ file: 'a.ts', line: 1 }, wd).lines.map(l => l.n)).toEqual([1, 2]);
        expect(readCodeFrame({ file: 'a.ts', line: 5 }, wd).lines.map(l => l.n)).toEqual([4, 5]);
    });

    it('is undefined when the file is unreadable or the line is out of range', () => {
        expect(readCodeFrame({ file: 'missing.ts', line: 1 }, wd)).toBeUndefined();
        expect(readCodeFrame({ file: 'a.ts', line: 99 }, wd)).toBeUndefined();
    });
});
