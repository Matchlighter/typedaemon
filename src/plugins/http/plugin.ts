import type { Express } from 'express';
import { Server, createServer } from "http";

// const express = require('express')
import express = require('express')

import { promisify } from "util";
import { TD_VERSION_PRECISE } from "../../common/util";
import { Plugin } from "../base";
import { AppHttpStore, HttpApi, httpApi } from "./api";

export interface HttpPluginConfig {
    type: "http";
    port?: number;
}

export class HttpPlugin extends Plugin<HttpPluginConfig> {
    readonly api: HttpApi = httpApi(this);

    private server: Server;
    private app: Express;

    async initialize() {
        this.server = createServer();
        this.server.listen(9000);
        this.app = express();
        this.server.on('request', this.app);

        this.app.use(express.json({}));

        this.app.get("/status", (req, resp, next) => {
            resp.json({
                status: "up",
                version: TD_VERSION_PRECISE,
            })
        })

        this.app.use("/app/:app", (req, resp, next) => {
            const appkey = req.params['app'];
            const app_store = this.app_stores[appkey];
            if (app_store) {
                return app_store.handle_request(req, resp, next);
            } else {
                next();
            }
        })
    }

    async shutdown() {
        this.server.closeAllConnections();
        await promisify(this.server.close).bind(this.server)();
    }

    private app_stores: Record<string, AppHttpStore> = {};
    registerAppStore(store: AppHttpStore) {
        const key = store.app.uuid;
        if (this.app_stores[key]) throw new Error("HTTP Store for app already registered!");
        this.app_stores[key] = store;
        return () => {
            if (this.app_stores[key] == store) delete this.app_stores[key];
        }
    }
    unregisterAppStore(store: AppHttpStore) {
        const key = store.app.uuid;
        delete this.app_stores[key];
    }

    // async request(type: string, parameters: any) {
    //     return await this._ha_api.sendMessagePromise({
    //         type,
    //         ...parameters,
    //     })
    // }

    configuration_updated(new_config, old_config) {
    }
}

// class HttpSubServer implements Server {
//     setTimeout(msecs?: number, callback?: () => void): this;
//     setTimeout(callback: () => void): this;
//     setTimeout(msecs?: unknown, callback?: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     maxHeadersCount: number;
//     maxRequestsPerSocket: number;
//     timeout: number;
//     headersTimeout: number;
//     keepAliveTimeout: number;
//     requestTimeout: number;

//     closeAllConnections(): void {
//         throw new Error("Method not implemented.");
//     }
//     closeIdleConnections(): void {
//         throw new Error("Method not implemented.");
//     }

//     addListener(event: string, listener: (...args: any[]) => void): this;
//     addListener(event: "close", listener: () => void): this;
//     addListener(event: "connection", listener: (socket: Socket) => void): this;
//     addListener(event: "error", listener: (err: Error) => void): this;
//     addListener(event: "listening", listener: () => void): this;
//     addListener(event: "checkContinue", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     addListener(event: "checkExpectation", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     addListener(event: "clientError", listener: (err: Error, socket: Duplex) => void): this;
//     addListener(event: "connect", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     addListener(event: "request", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     addListener(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     addListener(event: unknown, listener: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     emit(event: string, ...args: any[]): boolean;
//     emit(event: "close"): boolean;
//     emit(event: "connection", socket: Socket): boolean;
//     emit(event: "error", err: Error): boolean;
//     emit(event: "listening"): boolean;
//     emit(event: "checkContinue", req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage; }): boolean;
//     emit(event: "checkExpectation", req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage; }): boolean;
//     emit(event: "clientError", err: Error, socket: Duplex): boolean;
//     emit(event: "connect", req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
//     emit(event: "request", req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage; }): boolean;
//     emit(event: "upgrade", req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
//     emit(event: unknown, req?: unknown, socket?: unknown, head?: unknown, ...rest?: unknown[]): boolean {
//         throw new Error("Method not implemented.");
//     }

//     on(event: string, listener: (...args: any[]) => void): this;
//     on(event: "close", listener: () => void): this;
//     on(event: "connection", listener: (socket: Socket) => void): this;
//     on(event: "error", listener: (err: Error) => void): this;
//     on(event: "listening", listener: () => void): this;
//     on(event: "checkContinue", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     on(event: "checkExpectation", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     on(event: "clientError", listener: (err: Error, socket: Duplex) => void): this;
//     on(event: "connect", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     on(event: "request", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     on(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     on(event: unknown, listener: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     once(event: string, listener: (...args: any[]) => void): this;
//     once(event: "close", listener: () => void): this;
//     once(event: "connection", listener: (socket: Socket) => void): this;
//     once(event: "error", listener: (err: Error) => void): this;
//     once(event: "listening", listener: () => void): this;
//     once(event: "checkContinue", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     once(event: "checkExpectation", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     once(event: "clientError", listener: (err: Error, socket: Duplex) => void): this;
//     once(event: "connect", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     once(event: "request", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     once(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     once(event: unknown, listener: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     prependListener(event: string, listener: (...args: any[]) => void): this;
//     prependListener(event: "close", listener: () => void): this;
//     prependListener(event: "connection", listener: (socket: Socket) => void): this;
//     prependListener(event: "error", listener: (err: Error) => void): this;
//     prependListener(event: "listening", listener: () => void): this;
//     prependListener(event: "checkContinue", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     prependListener(event: "checkExpectation", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     prependListener(event: "clientError", listener: (err: Error, socket: Duplex) => void): this;
//     prependListener(event: "connect", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     prependListener(event: "request", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     prependListener(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     prependListener(event: unknown, listener: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     prependOnceListener(event: string, listener: (...args: any[]) => void): this;
//     prependOnceListener(event: "close", listener: () => void): this;
//     prependOnceListener(event: "connection", listener: (socket: Socket) => void): this;
//     prependOnceListener(event: "error", listener: (err: Error) => void): this;
//     prependOnceListener(event: "listening", listener: () => void): this;
//     prependOnceListener(event: "checkContinue", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     prependOnceListener(event: "checkExpectation", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     prependOnceListener(event: "clientError", listener: (err: Error, socket: Duplex) => void): this;
//     prependOnceListener(event: "connect", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     prependOnceListener(event: "request", listener: RequestListener<IncomingMessage, ServerResponse>): this;
//     prependOnceListener(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
//     prependOnceListener(event: unknown, listener: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void): this;
//     listen(port?: number, hostname?: string, listeningListener?: () => void): this;
//     listen(port?: number, backlog?: number, listeningListener?: () => void): this;
//     listen(port?: number, listeningListener?: () => void): this;
//     listen(path: string, backlog?: number, listeningListener?: () => void): this;
//     listen(path: string, listeningListener?: () => void): this;
//     listen(options: ListenOptions, listeningListener?: () => void): this;
//     listen(handle: any, backlog?: number, listeningListener?: () => void): this;
//     listen(handle: any, listeningListener?: () => void): this;
//     listen(port?: unknown, hostname?: unknown, backlog?: unknown, listeningListener?: unknown): this {
//         throw new Error("Method not implemented.");
//     }

//     close(callback?: (err?: Error) => void): this {
//         throw new Error("Method not implemented.");
//     }
//     address(): string | AddressInfo {
//         throw new Error("Method not implemented.");
//     }
//     getConnections(cb: (error: Error, count: number) => void): void {
//         throw new Error("Method not implemented.");
//     }
//     ref(): this {
//         throw new Error("Method not implemented.");
//     }
//     unref(): this {
//         throw new Error("Method not implemented.");
//     }
//     maxConnections: number;
//     connections: number;
//     listening: boolean;
//     removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
//         throw new Error("Method not implemented.");
//     }
//     off(eventName: string | symbol, listener: (...args: any[]) => void): this {
//         throw new Error("Method not implemented.");
//     }
//     removeAllListeners(event?: string | symbol): this {
//         throw new Error("Method not implemented.");
//     }
//     setMaxListeners(n: number): this {
//         throw new Error("Method not implemented.");
//     }
//     getMaxListeners(): number {
//         throw new Error("Method not implemented.");
//     }
//     listeners(eventName: string | symbol): Function[] {
//         throw new Error("Method not implemented.");
//     }
//     rawListeners(eventName: string | symbol): Function[] {
//         throw new Error("Method not implemented.");
//     }
//     listenerCount(eventName: string | symbol): number {
//         throw new Error("Method not implemented.");
//     }
//     eventNames(): (string | symbol)[] {
//         throw new Error("Method not implemented.");
//     }
// }
