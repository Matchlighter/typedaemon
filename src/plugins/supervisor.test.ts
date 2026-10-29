import http from "http";
import type { AddressInfo } from "net";

const load = (token: string | undefined) => {
    const prev = process.env['SUPERVISOR_TOKEN'];
    if (token === undefined) delete process.env['SUPERVISOR_TOKEN'];
    else process.env['SUPERVISOR_TOKEN'] = token;
    try {
        let mod!: typeof import("./supervisor");
        jest.isolateModules(() => { mod = require("./supervisor") });
        return mod.SUPERVISOR_API;
    } finally {
        if (prev === undefined) delete process.env['SUPERVISOR_TOKEN'];
        else process.env['SUPERVISOR_TOKEN'] = prev;
    }
};

describe("SUPERVISOR_API", () => {
    it("is absent outside an add-on", () => {
        expect(load(undefined)).toBeNull();
    });

    it("authenticates with the injected token and parses JSON responses", async () => {
        let auth: string | undefined;
        const server = http.createServer((req, res) => {
            auth = req.headers.authorization;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ data: { host: "core-mosquitto" } }));
        });
        await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
        try {
            const api = load("tok")!;
            api.defaults.baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            const res = await api.get("services/mqtt");
            expect(auth).toBe("Bearer tok");
            expect(res.data?.data).toEqual({ host: "core-mosquitto" });
        } finally {
            server.close();
        }
    });
});
