import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { DestroyerStore } from "./destroyer";
import { UtilityHypervisor } from "./hypervisor";
import { PersistentStorage } from "./persistent_storage";

const destroyed = jest.fn();
DestroyerStore.defineDestroyerClass("Test", async (app, options: { thing: string }) => {
    destroyed(app.id, options);
});

describe("Hypervisor.destroyApplication", () => {
    let working_directory: string;
    let hypervisor: UtilityHypervisor;

    const writeAppPersistence = async (id: string, data: Record<string, any>) => {
        const storage = new PersistentStorage(path.join(hypervisor.defaultAppOperatingDirectory(id), ".persistence.jkv"));
        for (let [k, v] of Object.entries(data)) storage.setValue(k, v, { min_time_to_disk: 0, max_time_to_disk: 10 });
        await storage.dispose();
    }

    beforeEach(async () => {
        destroyed.mockReset();

        working_directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "td-destroy-"));
        await fs.promises.writeFile(path.join(working_directory, "typedaemon_config.json"), JSON.stringify({
            apps: {
                current_app: { source: "./current_app.ts" },
            },
        }));

        hypervisor = new UtilityHypervisor({ working_directory, no_watching: true });
        await hypervisor.start();

        for (let id of ["current_app", "old_app"]) {
            await fs.promises.mkdir(hypervisor.defaultAppOperatingDirectory(id), { recursive: true });
        }
    });

    afterEach(async () => {
        await hypervisor.shutdown();
        await fs.promises.rm(working_directory, { recursive: true, force: true });
    });

    it("finds apps that are no longer configured", async () => {
        expect(await hypervisor.findOrphanedApplications()).toEqual(["old_app"]);
    });

    it("runs registered destroyers and removes the operating directory", async () => {
        await writeAppPersistence("old_app", {
            _destroyers: {
                "Test-1": { uuid: "Test-1", type: "Test", options: { thing: "a" } },
            },
        });

        await hypervisor.destroyApplication("old_app");

        expect(destroyed).toHaveBeenCalledWith("old_app", { thing: "a" });
        expect(fs.existsSync(hypervisor.defaultAppOperatingDirectory("old_app"))).toBe(false);
        expect(await hypervisor.findOrphanedApplications()).toEqual([]);
    });

    it("refuses to destroy configured apps", async () => {
        await expect(hypervisor.destroyApplication("current_app")).rejects.toThrow(/still configured/);
        expect(fs.existsSync(hypervisor.defaultAppOperatingDirectory("current_app"))).toBe(true);
    });

    it("refuses unknown apps and paths", async () => {
        await expect(hypervisor.destroyApplication("nope")).rejects.toThrow(/No resources found/);
        await expect(hypervisor.destroyApplication("../app_environments")).rejects.toThrow(/Invalid app/);
    });
});
