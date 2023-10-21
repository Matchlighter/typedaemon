
import express = require('express')
import path = require('path');

import { HttpPlugin } from ".";
import { ApplicationInstance } from '../../hypervisor/application_instance';
import { current } from "../../hypervisor/current";
import { int_callback_or_decorator } from '../../runtime/hooks/util';
import { assert_application_context, bind_callback_env, getOrCreateLocalData, makeApiExport, pluginGetterFactory } from "../base";

export type RequestHandler = express.RequestHandler;

export class AppHttpStore {
    constructor(readonly plugin: HttpPlugin, readonly app: ApplicationInstance) {
        app.cleanups.append(() => this.cleanup());
        plugin.registerAppStore(this);
    }

    readonly router = express.Router({ });

    handle_request: RequestHandler = (req, resp, next) => {
        return this.router(req, resp, next);
    }

    private async cleanup() {
        this.plugin.unregisterAppStore(this);
    }
}

export function httpApi(options: { pluginId: string }) {
    const _plugin = pluginGetterFactory<HttpPlugin>(options.pluginId, httpApi.defaultPluginId);

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

        // As Server
        handle: request_api,
        serve_static,
    }
}
httpApi.defaultPluginId = "http"

export type httpApi = ReturnType<typeof httpApi>;

export const api = makeApiExport(httpApi)