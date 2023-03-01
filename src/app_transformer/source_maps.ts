
import smc = require('source-map');

interface SourceMapEntry {
    counter: number;
    map: any;
}

const REGISTERED_MAPS: Record<string, SourceMapEntry> = {};

export function registerSourceMap(file: string, map: any) {
    if (!REGISTERED_MAPS[file]) {
        REGISTERED_MAPS[file] = {
            counter: 0,
            map,
        }
    }

    REGISTERED_MAPS[file].counter += 1;
    REGISTERED_MAPS[file].map = map;

    return () => {
        REGISTERED_MAPS[file].counter -= 1;
        if (REGISTERED_MAPS[file].counter < 1) {
            delete REGISTERED_MAPS[file];
        }
    }
}

export function mapStackTrace(err: Error | string[]) {
    let stack: string[] = [];
    if (err instanceof Error) {
        stack = err.stack?.split("\n") || []
        stack.shift();
    } else {
        stack = err || []
    }

    const errors = stack.map((line) => {
        const [left, _trace, right] = line.split(/[()]/g);
        // let _trace = line.split('(').pop();
        // _trace = trim(_trace, ')');

        const bits = _trace.split(':');
        const trace = {
            filename: bits[0].split("?")[0],
            line: parseInt(bits[1], 10),
            column: parseInt(bits[2], 10),
            original_line: line,
            left, right,
        };

        return trace;
    });

    const consumers: Record<string, smc.SourceMapConsumer> = {};
    const getConsumer = (file: string) => {
        if (!consumers[file] && REGISTERED_MAPS[file]) {
            consumers[file] = new smc.SourceMapConsumer(REGISTERED_MAPS[file].map);
        }
        return consumers[file]
    }

    const mapped_lines = []
    for (let err of errors) {
        const file = err.filename;
        const cons = getConsumer(file);
        if (cons) {
            const m = cons.originalPositionFor(err);
            mapped_lines.push(`${err.left}(${err.filename}:${m.line}:${m.column})${err.right}`)
        } else {
            mapped_lines.push(err.original_line);
        }
    }
    return mapped_lines;
}
