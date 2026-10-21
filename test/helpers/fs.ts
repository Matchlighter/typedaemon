import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Give each test in the enclosing `describe` its own temporary directory.
 *
 * Directories are removed in `afterAll` so that other `afterEach` hooks (eg. ones flushing stores to disk) may still use them.
 */
export function useTempDir(prefix = "td-test-") {
    const created: string[] = [];

    const ctx = {
        dir: null as string,
        path: (...parts: string[]) => path.join(ctx.dir, ...parts),
        read: (file: string) => fs.readFileSync(ctx.path(file)).toString(),
        exists: (file: string) => fs.existsSync(ctx.path(file)),
        write: (file: string, content: string) => fs.writeFileSync(ctx.path(file), content),
    };

    beforeEach(() => {
        ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        created.push(ctx.dir);
    });

    afterAll(() => {
        for (let dir of created.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    return ctx;
}
