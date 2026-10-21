import { once } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CliError } from "../common/cli_helpers";
import { controlRequest, controlSocketPath, controlStream } from "../common/control_socket";
import { ControlServer } from "./control_server";

describe("ControlServer", () => {
    let working_directory: string;
    let server: ControlServer;

    beforeEach(async () => {
        working_directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "td-control-"));
        await fs.promises.mkdir(path.join(working_directory, ".typedaemon"));
        server = new ControlServer(controlSocketPath(working_directory), () => { });
    });

    afterEach(async () => {
        await server.dispose();
        await fs.promises.rm(working_directory, { recursive: true, force: true });
    });

    it("returns handler results", async () => {
        server.handle("add", ({ a, b }) => a + b);
        await server.start();

        expect(await controlRequest(working_directory, "add", { a: 1, b: 2 })).toBe(3);
    });

    it("reports handler errors as CliErrors", async () => {
        server.handle("fail", async () => { throw new Error("Nope") });
        await server.start();

        await expect(controlRequest(working_directory, "fail")).rejects.toThrow(new CliError("Nope"));
    });

    it("rejects unknown commands", async () => {
        await server.start();

        await expect(controlRequest(working_directory, "missing")).rejects.toThrow("Unknown command 'missing'");
    });

    it("hands the socket to stream handlers", async () => {
        server.handle("echo", (args, socket) => socket.pipe(socket), { stream: true });
        await server.start();

        const socket = await controlStream(working_directory, "echo");
        socket.write("hello");
        socket.resume();
        const [data] = await once(socket, "data");
        expect(data.toString()).toBe("hello");
        socket.end();
    });

    it("restricts and removes the socket file", async () => {
        const socket_path = controlSocketPath(working_directory);
        await fs.promises.writeFile(socket_path, "stale");

        await server.start();
        expect((await fs.promises.stat(socket_path)).mode & 0o777).toBe(0o600);

        await server.dispose();
        expect(fs.existsSync(socket_path)).toBe(false);
    });

    it("reports when the Hypervisor is not running", async () => {
        await expect(controlRequest(working_directory, "add")).rejects.toThrow(/Is it running\?/);
    });
});
