import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { controlSocketPath, controlStream } from "../common/control_socket";
import { ControlServer } from "./control_server";
import type { Hypervisor } from "./hypervisor";
import { startRepl } from "./repl";

describe("startRepl", () => {
    let working_directory: string;
    let server: ControlServer;

    beforeEach(async () => {
        working_directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "td-repl-"));
        await fs.promises.mkdir(path.join(working_directory, ".typedaemon"));

        const hypervisor = { working_directory } as Hypervisor;
        server = new ControlServer(controlSocketPath(working_directory), () => { });
        server.handle("repl", (args, socket) => startRepl(hypervisor, socket, args), { stream: true });
        await server.start();
    });

    afterEach(async () => {
        await server.dispose();
        await fs.promises.rm(working_directory, { recursive: true, force: true });
    });

    it("evaluates against the Hypervisor and closes when input ends", async () => {
        const socket = await controlStream(working_directory, "repl", { terminal: false });

        let output = "";
        socket.on("data", (d) => output += d.toString());
        socket.resume();

        const closed = new Promise(resolve => socket.on("close", resolve));
        socket.end("hypervisor.working_directory.length\n");
        await closed;

        expect(output).toContain(String(working_directory.length));
    });
});
