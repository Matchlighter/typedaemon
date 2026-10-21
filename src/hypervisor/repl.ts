import * as net from "net";
import * as repl from "repl";

import type { Hypervisor } from "./hypervisor";

export interface ReplOptions {
    /** Whether the client is an interactive terminal */
    terminal?: boolean;
    columns?: number;
}

/** Run a Node REPL inside the Hypervisor process, attached to the given socket */
export function startRepl(hypervisor: Hypervisor, socket: net.Socket, { terminal, columns }: ReplOptions = {}) {
    // readline uses these to lay out the prompt
    Object.assign(socket, { columns, isTTY: terminal });

    const server = repl.start({
        prompt: "td> ",
        input: socket,
        output: socket,
        terminal: !!terminal,
        useColors: !!terminal,
    });

    server.context.hypervisor = hypervisor;

    server.on("exit", () => socket.end());
    socket.on("close", () => server.close());
}
