import { comparer } from "mobx";

import { logPluginClientMessage } from "../../../../hypervisor/logging";
import { plgmobx } from "../../../mobx";
import { EntityClass } from "./base";

export interface StreamCameraOptions {
    /** URL HA fetches still images (snapshots/thumbnails) from. If unset, HA grabs stills from the stream. */
    still_image_url?: string;
}

/**
 * Camera with a live stream (RTSP/HLS/... URL), provided through the TypeDaemon companion integration
 * (`custom_components/typedaemon`) because MQTT cameras can't carry a stream. State is the stream URL (HA's `stream`
 * component handles HLS/WebRTC); attributes become the camera's extra state attributes.
 *
 * Talks to HA over the websocket instead of MQTT: `typedaemon/camera/register` (a subscription - the entity is
 * available while it's open), `typedaemon/camera/update` and `typedaemon/camera/remove`.
 * See `TDCamera` for an MQTT snapshot camera.
 */
export class TDStreamCamera extends EntityClass<string | undefined, {}, StreamCameraOptions> {
    static domain = "camera";
    static entity_kind = "stream_camera";

    static { this._defaultAutocleaner(); }

    protected get ws() {
        return this._bound_store.plugin._ha_api;
    }

    /** Full camera config as sent to the companion integration */
    protected ws_config() {
        return {
            unique_id: this.uuid,
            name: this.display_name,
            stream_source: this.getState() ?? null,
            still_image_url: this.options?.still_image_url ?? null,
            attributes: this.getExtraAttributes() ?? {},
            device: this.device,
        }
    }

    protected command_keys(): string[] {
        return [];
    }

    private _unsubscribe?: () => Promise<void>;

    /** Open the `register` subscription with the current config */
    protected async _subscribe() {
        const ws = this.ws;
        const unsub = await ws.subscribeMessage(() => { }, { type: "typedaemon/camera/register", ...this.ws_config() }, { resubscribe: false });
        if (!this._bound_store) {
            // Unlinked while subscribing
            await unsub();
            return;
        }
        this._unsubscribe = unsub;
    }

    protected async _register_in_ha() {
        const ws = this.ws;
        await this._subscribe();
        this._disposers.append(() => this._unsubscribe?.());

        // Not `resubscribe: true`: the library would replay the original message (stale config). HA drops the
        // registration with the connection, so register afresh with the current config once reconnected.
        let dropped = false;
        const on_disconnected = () => { dropped = true };
        const on_ready = () => {
            if (!dropped) return;
            dropped = false;
            this._subscribe().catch(err => this._log_error("re-registering", err));
        };
        ws.addEventListener("disconnected", on_disconnected);
        ws.addEventListener("ready", on_ready);
        this._disposers.append(() => {
            ws.removeEventListener("disconnected", on_disconnected);
            ws.removeEventListener("ready", on_ready);
        });

        this._disposers.append(plgmobx.reaction(this.application, () => this.ws_config(), () => {
            // While disconnected, the re-registration carries the change
            if (!ws.connected) return;
            this.reconfigure().catch(err => this._log_error("updating", err));
        }, { equals: comparer.structural }));
    }

    private _log_error(doing: string, err: any) {
        logPluginClientMessage(this._bound_store?.plugin, "error", `Error ${doing} stream camera '${this.uuid}':`, err);
    }

    /** Availability follows the `register` subscription, which the disposers close */
    async _unlink() { }

    /** Remove the camera (and its registry entry) from HA. Also used by autoclean, so must work unregistered. */
    async _destroy() {
        await this._bound_store.plugin.request("typedaemon/camera/remove", { unique_id: this.uuid });
    }

    /** Push the current config to HA */
    async reconfigure() {
        await this._bound_store.plugin.request("typedaemon/camera/update", this.ws_config());
    }
}
