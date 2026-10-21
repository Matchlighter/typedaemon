import * as fs from "fs";
import * as net from "net";

import { ControlRequest, readLine, writeMessage } from "../common/control_socket";
import { LogLevel } from "./logging";

export type ControlHandler = (args: any, socket: net.Socket) => any;

interface HandlerEntry {
    handler: ControlHandler;
    stream: boolean;
}

/** Serves commands from the `td` CLI over a Unix socket. See `common/control_socket` for the protocol */
export class ControlServer {
    constructor(readonly socket_path: string, private logMessage: (level: LogLevel, ...rest) => void) { }

    private handlers: Record<string, HandlerEntry> = {};
    private server: net.Server;
    private connections = new Set<net.Socket>();

    /**
     * Register a command.
     * The handler's return value is sent to the client as the result.
     * If `stream` is set, the handler instead takes ownership of the socket.
     */
    handle(command: string, handler: ControlHandler, { stream = false }: { stream?: boolean } = {}) {
        this.handlers[command] = { handler, stream };
    }

    async start() {
        // Remove a stale socket from an unclean shutdown
        await fs.promises.rm(this.socket_path, { force: true });

        this.server = net.createServer(socket => this.handleConnection(socket));
        await new Promise<void>((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(this.socket_path, () => {
                this.server.off("error", reject);
                resolve();
            });
        })

        // Anyone that can connect has full control of TypeDaemon
        await fs.promises.chmod(this.socket_path, 0o600);
    }

    async dispose() {
        if (!this.server) return;
        for (let socket of this.connections) socket.destroy();
        // Also removes the socket file
        await new Promise(resolve => this.server.close(resolve));
    }

    private async handleConnection(socket: net.Socket) {
        this.connections.add(socket);
        socket.on("close", () => this.connections.delete(socket));
        socket.on("error", (err) => this.logMessage("debug", `Control connection error:`, err));

        let entry: HandlerEntry;
        let args;
        try {
            const request: ControlRequest = JSON.parse(await readLine(socket));
            entry = this.handlers[request.command];
            if (!entry) throw new Error(`Unknown command '${request.command}'`);
            args = request.args;
        } catch (ex) {
            writeMessage(socket, { error: ex.message });
            socket.end();
            return;
        }

        if (entry.stream) {
            writeMessage(socket, {});
            try {
                await entry.handler(args, socket);
            } catch (ex) {
                this.logMessage("error", `Control stream failed:`, ex);
                socket.destroy();
            }
        } else {
            try {
                const result = await entry.handler(args, socket);
                writeMessage(socket, { result });
            } catch (ex) {
                writeMessage(socket, { error: ex.message });
            }
            socket.end();
        }
    }
}
