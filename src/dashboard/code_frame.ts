import * as fs from "fs";
import * as path from "path";
import type { CodeFrame, ErrorFrame } from "./protocol";

/** Source lines around a (source-mapped) frame: the hit line plus one line of context each side. Undefined if unreadable. */
export function readCodeFrame(frame: ErrorFrame, workingDirectory: string): CodeFrame | undefined {
    let src: string[];
    try { src = fs.readFileSync(path.resolve(workingDirectory, frame.file), 'utf8').split(/\r?\n/) } catch { return undefined }
    if (frame.line < 1 || frame.line > src.length) return undefined;
    const from = Math.max(1, frame.line - 1), to = Math.min(src.length, frame.line + 1);
    const lines: CodeFrame['lines'] = [];
    for (let n = from; n <= to; n++) lines.push({ n, text: src[n - 1] });
    return { file: frame.file, line: frame.line, col: frame.col, lines };
}
