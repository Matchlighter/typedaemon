import * as path from "path";
import type { ErrorFrame } from "./protocol";

const FRAME = /^\s*at (?:async )?(?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** Parse V8 stack lines (e.g. from a source-mapped stack) into structured frames. Non-frame lines are dropped. */
export function parseStackFrames(lines: string[], workingDirectory: string): ErrorFrame[] {
    const frames: ErrorFrame[] = [];
    for (const line of lines) {
        const m = FRAME.exec(line);
        if (!m) continue;
        const [, fn, rawFile, l, c] = m;
        let file = rawFile.replace(/^file:\/\//, '').split('?')[0];
        if (path.isAbsolute(file)) {
            const rel = path.relative(workingDirectory, file);
            if (!rel.startsWith('..')) file = rel;
        }
        frames.push(fn ? { fn, file, line: +l, col: +c } : { file, line: +l, col: +c });
    }
    return frames;
}
