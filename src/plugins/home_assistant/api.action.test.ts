const mockApplication = {
    invoke: (fn: Function, ...args: any[]) => fn(...args),
    logClientMessage: jest.fn(),
    cleanups: {
        unorderedGroup: () => ({ addExposed: (f: Function) => f }),
    },
};

jest.mock('../../hypervisor/current', () => ({
    current: {
        get application() { return mockApplication },
    }
}));

jest.mock('../../hypervisor/logging', () => ({
    logMessage: jest.fn(),
    logPluginClientMessage: jest.fn(),
}));

import { homeAssistantApi } from './api';

function setup() {
    let handler: (payload: any) => any;
    const unsubscribe = jest.fn();
    const plugin: any = {
        request: jest.fn(async () => null),
        _ha_api: {
            subscribeMessage: jest.fn(async (cb) => {
                handler = cb;
                return unsubscribe;
            }),
        },
    };
    const api = homeAssistantApi(plugin);
    return { api, plugin, unsubscribe, call: (payload) => handler(payload) };
}

const call_payload = (data = {}) => ({
    call_id: "abc",
    data,
    context: { id: "ctx", user_id: null, parent_id: null },
    return_response: true,
});

describe("ha.action", () => {
    it("registers the action with HA", () => {
        const { api, plugin } = setup();
        api.action("my_action", { name: "My Action", fields: { x: { selector: { text: {} } } } })(() => { });

        expect(plugin._ha_api.subscribeMessage).toHaveBeenCalledWith(expect.any(Function), {
            type: "typedaemon/action/register",
            service: "my_action",
            name: "My Action",
            description: undefined,
            fields: { x: { selector: { text: {} } } },
        }, { resubscribe: true });
    });

    it("responds with the handler result", async () => {
        const { api, plugin, call } = setup();
        const handler = jest.fn(async (data) => ({ doubled: data.x * 2 }));
        api.action("my_action")(handler);

        await call(call_payload({ x: 2 }));

        expect(handler).toHaveBeenCalledWith({ x: 2 }, {
            data: { x: 2 },
            context: { id: "ctx", user_id: null, parent_id: null },
            return_response: true,
        });
        expect(plugin.request).toHaveBeenCalledWith("typedaemon/action/response", { call_id: "abc", response: { doubled: 4 } });
    });

    it("responds with null when the handler returns nothing", async () => {
        const { api, plugin, call } = setup();
        api.action("my_action")(() => { });

        await call(call_payload());

        expect(plugin.request).toHaveBeenCalledWith("typedaemon/action/response", { call_id: "abc", response: null });
    });

    it("reports handler errors to HA and rethrows", async () => {
        const { api, plugin, call } = setup();
        api.action("my_action")(() => { throw new Error("boom") });

        await expect(call(call_payload())).rejects.toThrow("boom");

        expect(plugin.request).toHaveBeenCalledWith("typedaemon/action/response", { call_id: "abc", error: "boom" });
    });

    it("unregisters when disposed", async () => {
        const { api, unsubscribe } = setup();
        const dispose = api.action("my_action")(() => { });

        await new Promise(setImmediate);
        await dispose();

        expect(unsubscribe).toHaveBeenCalled();
    });
});
