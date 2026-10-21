import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseYaml } from "./ha_yaml";

describe("parseYaml", () => {
    it("returns the parsed object from a real YAML file", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ha_yaml-"));
        const file = path.join(dir, "config.yaml");
        fs.writeFileSync(file, "apps:\n  - name: foo\n    enabled: true\nlevel: 3\n");
        try {
            const parsed = parseYaml(fs.readFileSync(file).toString(), { filename: file });
            expect(parsed).toEqual({ apps: [{ name: "foo", enabled: true }], level: 3 });
        } finally {
            fs.rmSync(dir, { recursive: true });
        }
    });

    it("supports HA !secret tags", () => {
        expect(parseYaml("token: !secret my_token\n", { filename: "x.yaml" }))
            .toEqual({ token: "secret my_token" });
    });

    it("includes the filename in syntax errors", () => {
        expect(() => parseYaml("a: [1, 2\n", { filename: "broken.yaml" })).toThrow(/broken\.yaml/);
    });
});
