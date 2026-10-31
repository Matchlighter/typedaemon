import type { ClientMessage, ServerMessage } from "./protocol";
import type { ActionRegistry } from "./actions";
import type { TopicRegistry } from "./topics";

/** Minimal transport so the channel is testable without a real websocket. */
export interface AdminSocket {
    send(raw: string): void;
    onMessage(cb: (raw: string) => void): void;
    onClose(cb: () => void): void;
}

interface Sub {
    unsubscribe?: () => void;
    cancelled: boolean;
}

/** One per websocket connection: tracks subscriptions, sends snapshot then deltas. */
export class AdminChannel {
    private subs = new Map<number, Sub>();

    constructor(private registry: TopicRegistry, private socket: AdminSocket, private actions?: ActionRegistry) {
        socket.onMessage(raw => this.handle(raw));
        socket.onClose(() => this.dispose());
    }

    private send(msg: ServerMessage) {
        try { this.socket.send(JSON.stringify(msg)) } catch { /* socket gone; close handler cleans up */ }
    }

    private handle(raw: string) {
        let msg: ClientMessage;
        try { msg = JSON.parse(raw) } catch { return }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'subscribe') this.subscribe(msg);
        else if (msg.type === 'unsubscribe') this.unsubscribe(msg.id);
        else if (msg.type === 'call') this.call(msg);
    }

    private async call({ id, action, params }: Extract<ClientMessage, { type: 'call' }>) {
        const handler = this.actions?.get(action);
        if (!handler) return this.send({ type: 'result', id, ok: false, message: `Unknown action: ${action}` });
        try {
            const data = await handler(params);
            this.send({ type: 'result', id, ok: true, ...(data !== undefined && { data }) });
        } catch (e) {
            this.send({ type: 'result', id, ok: false, message: String(e?.message ?? e) });
        }
    }

    private async subscribe(msg: Extract<ClientMessage, { type: 'subscribe' }>) {
        const { id, topic, params } = msg;
        const provider = this.registry.get(topic);
        if (!provider) return this.send({ type: 'error', id, message: `Unknown topic: ${topic}` });
        this.unsubscribe(id);

        const sub: Sub = { cancelled: false };
        this.subs.set(id, sub);
        let snapshotSent = false;
        const buffered: unknown[] = [];
        try {
            sub.unsubscribe = provider.subscribe(params, delta => {
                if (sub.cancelled) return;
                if (!snapshotSent) buffered.push(delta);
                else this.send({ type: 'delta', id, data: delta });
            });
            const data = await provider.snapshot(params);
            if (sub.cancelled) return;
            this.send({ type: 'snapshot', id, data });
            snapshotSent = true;
            for (const d of buffered) this.send({ type: 'delta', id, data: d });
        } catch (e) {
            this.unsubscribe(id);
            this.send({ type: 'error', id, message: String(e?.message ?? e) });
        }
    }

    private unsubscribe(id: number) {
        const sub = this.subs.get(id);
        if (!sub) return;
        sub.cancelled = true;
        this.subs.delete(id);
        sub.unsubscribe?.();
    }

    dispose() {
        for (const id of [...this.subs.keys()]) this.unsubscribe(id);
    }
}
