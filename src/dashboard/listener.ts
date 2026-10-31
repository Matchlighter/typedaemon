import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { promisify } from "util";
import { dashboardAuthorizer, type DashboardAuthOptions } from "./auth";
import { mountDashboard, type DashboardHost } from "./server";

export interface DashboardListenerOptions extends DashboardAuthOptions {
    /** Port to listen on (0 for an ephemeral one) */
    port: number;
}

export interface DashboardListener {
    /** The port actually bound */
    readonly port: number;
    dispose(): Promise<void>;
}

/** Hypervisor-owned HTTP listener serving the dashboard and its admin websocket; independent of the `http` plugin. */
export async function startDashboardListener(host: DashboardHost, { port, token }: DashboardListenerOptions): Promise<DashboardListener> {
    const server = createServer();
    const app = express();
    server.on('request', app);
    const unmount = mountDashboard(server, app, host, dashboardAuthorizer({ token }));

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, () => { server.off('error', reject); resolve() });
        });
    } catch (ex) {
        unmount();
        throw ex;
    }

    return {
        port: (server.address() as AddressInfo).port,
        async dispose() {
            unmount();
            server.closeAllConnections();
            await promisify(server.close).bind(server)();
        },
    };
}
