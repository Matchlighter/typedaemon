import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.mock("execa", () => jest.fn(() => {
    const proc: any = Promise.resolve({ exitCode: 0, failed: false });
    proc.stdout = { on: jest.fn() };
    proc.stderr = { on: jest.fn() };
    return proc;
}));
jest.mock("./logging", () => ({ logMessage: jest.fn() }));

import execa from "execa";
import { installConfigDependencies, YARN_BIN } from "./packages";

const yarnInstalls = () => (execa as any as jest.Mock).mock.calls.filter(c => c[0] == YARN_BIN);

describe("installConfigDependencies", () => {
    let dir: string;
    beforeEach(async () => {
        (execa as any as jest.Mock).mockClear();
        dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "td-preinstall-"));
    });
    afterEach(async () => {
        await fs.promises.rm(dir, { recursive: true, force: true });
    });

    const readPkg = async () => JSON.parse(await fs.promises.readFile(path.join(dir, "package.json"), "utf8"));

    test("installs configured packages into the config root with a managed package.json", async () => {
        await installConfigDependencies(dir, { "lodash": "^4.17.0" });

        expect(yarnInstalls()).toHaveLength(1);
        expect(yarnInstalls()[0][2].cwd).toBe(dir);
        const pkg = await readPkg();
        expect(pkg.typedaemon_managed).toBe(true);
        expect(pkg.dependencies).toEqual({ "lodash": "^4.17.0" });
    });

    test("does nothing when no packages are configured", async () => {
        await installConfigDependencies(dir, undefined);
        await installConfigDependencies(dir, {});

        expect(yarnInstalls()).toHaveLength(0);
        expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
    });

    test("skips install when already satisfied", async () => {
        await installConfigDependencies(dir, { "lodash": "^4.17.0" });
        await fs.promises.mkdir(path.join(dir, "node_modules"));

        await installConfigDependencies(dir, { "lodash": "^4.17.0" });
        expect(yarnInstalls()).toHaveLength(1);

        await installConfigDependencies(dir, { "lodash": "^4.17.0", "dayjs": "^1.0.0" });
        expect(yarnInstalls()).toHaveLength(2);
        expect((await readPkg()).dependencies).toEqual({ "lodash": "^4.17.0", "dayjs": "^1.0.0" });
    });

    test("never overwrites a user-managed package.json", async () => {
        const userPkg = { name: "mine", dependencies: { "left-pad": "1.0.0" } };
        await fs.promises.writeFile(path.join(dir, "package.json"), JSON.stringify(userPkg));

        await installConfigDependencies(dir, { "lodash": "^4.17.0" });

        expect(yarnInstalls()).toHaveLength(0);
        expect(await readPkg()).toEqual(userPkg);
    });
});
