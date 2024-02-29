
import express = require('express')
import path = require('path');
import { Socket } from 'net';

import { HttpPlugin } from "./plugin";
import { ApplicationInstance } from '../../hypervisor/application_instance';
import { current } from "../../hypervisor/current";
import { int_callback_or_decorator } from '../util';
import { assert_application_context, bind_callback_env, getOrCreateLocalData, handle_client_error, makeApiExport } from "../base";

export type RequestHandler = express.RequestHandler;

export class AppHttpStore {
    constructor(readonly plugin: HttpPlugin, readonly app: ApplicationInstance) {
        app.cleanups.append(() => this.cleanup());
        plugin.registerAppStore(this);
    }

    readonly router = express.Router({ });

    handle_request: RequestHandler = (req, resp, next) => {
        console.debug(`[HTTP] ${req.method.toUpperCase()}: ${req.originalUrl}`);
        this.trackSocket(req.socket);
        this.app.invoke(() => {
            try {
                this.router(req, resp, next);
            } catch (ex) {
                handle_client_error(ex);
                throw ex;
            }
        })
    }

    private openSockets = new Set<Socket>();

    protected trackSocket(sock: Socket) {
        this.openSockets.add(sock);
        sock.once("close", () => {
            this.openSockets.delete(sock);
        })
    }

    private async cleanup() {
        this.plugin.unregisterAppStore(this);
        for (let sock of this.openSockets) {
            sock.destroy();
        }
    }
}

export function httpApi(plugin_instace: HttpPlugin) {
    const _plugin = () => plugin_instace;

    const _store = () => {
        assert_application_context();
        return getOrCreateLocalData(_plugin(), current.application, "http_store", (plg, app) => new AppHttpStore(plg, app));
    }

    const _request = (method: string, path: string) => {
        return int_callback_or_decorator((f: RequestHandler) => {
            f = bind_callback_env(f);
            _store().router[method.toLowerCase()](path, f);
        })
    }

    const _method = (method: string) => {
        return (path: string) => _request(method, path);
    }

    const serve_static = (prefix: string, data_path: string) => {
        data_path = path.resolve(current.application.source_directory, data_path);
        _store().router.use(prefix, express.static(data_path, { }));
    }

    const server_methods = {
        get: _method('GET'),
        post: _method('POST'),
        put: _method('PUT'),
        head: _method('HEAD'),
        delete: _method('DELETE'),
        options: _method('OPTIONS'),

        all: _method('all'),
    }

    const request_api: ((method: Uppercase<keyof typeof server_methods>, path: string) => ReturnType<typeof _request>) & typeof server_methods = _request as any;
    Object.assign(request_api, server_methods);

    return {
        _getPlugin: _plugin,
        get _plugin() { return _plugin() },

        // As Client
        fetch,
        // TODO Re-export axios?

        // As Server
        handle: request_api,
        serve_static,
    }
}
httpApi.defaultPluginId = "http"

export type HttpApi = ReturnType<typeof httpApi>;

export const api = makeApiExport(httpApi)
