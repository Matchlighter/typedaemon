import { SubCountingConnection } from "./plugin";

class FakeSocket {
    readyState = 1;
    OPEN = 1;
    haVersion = "2024.1.0";
    sent: any[] = [];
    private listeners: Record<string, ((e: any) => void)[]> = {};
    addEventListener(t: string, cb: any) { (this.listeners[t] ||= []).push(cb) }
    removeEventListener(t: string, cb: any) { this.listeners[t] = (this.listeners[t] || []).filter(l => l !== cb) }
    send(data: string) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3; this.emit("close", {}) }
    emit(t: string, e: any) { (this.listeners[t] || []).forEach(l => l(e)) }
    /** Answer the most recent subscribe with success */
    ack(id: number) { this.emit("message", { data: JSON.stringify({ id, type: "result", success: true, result: null }) }) }
    event(id: number, event: any) { this.emit("message", { data: JSON.stringify({ id, type: "event", event }) }) }
}

describe("SubCountingConnection", () => {
    it("survives a reconnect: resubscribes on the server once, delivers events once, no recursion", async () => {
        const first = new FakeSocket();
        const second = new FakeSocket();
        const conn = new SubCountingConnection(first as any, { setupRetry: 0, createSocket: async () => second as any } as any);

        const cb = jest.fn();
        const p = conn.subscribeMessage(cb, { type: "subscribe_events" });
        const subId = first.sent[0].id;
        first.ack(subId);
        await p;

        // Second subscriber to the same message shares the server subscription
        const cb2 = jest.fn();
        const p2 = conn.subscribeMessage(cb2, { type: "subscribe_events" });
        await p2;
        expect(first.sent.length).toBe(1);

        jest.useFakeTimers();
        first.close();
        await jest.advanceTimersByTimeAsync(1000);
        jest.useRealTimers();

        const resub = second.sent.filter(m => m.type === "subscribe_events");
        expect(resub).toHaveLength(1);
        second.ack(resub[0].id);
        await new Promise(r => setImmediate(r));

        expect(Object.keys((conn as any).subscription_counts)).toHaveLength(1);
        second.event(resub[0].id, { n: 1 });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });
});
