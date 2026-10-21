import * as net from "net";
import * as path from "path";

import { CliError } from "./cli_helpers";
import { operationsDirectory } from "./util";

/*
 * Protocol for the Unix socket that the `td` CLI uses to talk to a running Hypervisor.
 *
 * Every message is a single line of JSON.
 *  1. The client sends a `ControlRequest`
 *  2. The server replies with a `ControlResponse`
 *  3. For regular commands, the connection is then closed.
 *     For stream commands, the connection is handed over to the command (eg the REPL)
 */

export interface ControlRequest {
    command: string;
    args?: any;
}

export interface ControlResponse {
    error?: string;
    result?: any;
}

export const controlSocketPath = (working_directory: string) => path.join(operationsDirectory(working_directory), "control.sock");

export function writeMessage(socket: net.Socket, message: ControlRequest | ControlResponse) {
    socket.write(JSON.stringify(message) + "\n");
}

/** Read a single line from the socket, leaving any further data unconsumed */
export function readLine(socket: net.Socket): Promise<string> {
    return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);

        const onData = (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            const idx = buffer.indexOf("\n");
            if (idx < 0) return;

            cleanup();
            socket.pause();
            const rest = buffer.subarray(idx + 1);
            if (rest.length) socket.unshift(rest);
            resolve(buffer.subarray(0, idx).toString());
        }
        const onEnd = () => {
            cleanup();
            reject(new Error("Connection closed unexpectedly"));
        }
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        }
        const cleanup = () => {
            socket.off("data", onData);
            socket.off("end", onEnd);
            socket.off("error", onError);
        }

        socket.on("data", onData);
        socket.on("end", onEnd);
        socket.on("error", onError);
    })
}

async function sendControlRequest(working_directory: string, request: ControlRequest) {
    const socket_path = controlSocketPath(working_directory);
    const socket = net.createConnection(socket_path);

    try {
        await new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", reject);
        })
    } catch (ex) {
        throw new CliError(`Could not connect to TypeDaemon at ${socket_path} (${ex.code || ex.message}). Is it running?`);
    }

    writeMessage(socket, request);
    const response: ControlResponse = JSON.parse(await readLine(socket));
    if (response.error) {
        socket.destroy();
        throw new CliError(response.error);
    }

    return { socket, response };
}

/** Execute a command in the running Hypervisor and return its result */
export async function controlRequest<T = any>(working_directory: string, command: string, args?: any): Promise<T> {
    const { socket, response } = await sendControlRequest(working_directory, { command, args });
    socket.end();
    return response.result;
}

/** Start a stream command in the running Hypervisor and return the (paused) socket connected to it */
export async function controlStream(working_directory: string, command: string, args?: any) {
    const { socket } = await sendControlRequest(working_directory, { command, args });
    return socket;
}
