import { ERR_CONNECTION_LOST } from "home-assistant-js-websocket";

/**
 * The rejection `home-assistant-js-websocket` gives requests still in flight when the socket drops
 * (a plain `{type:'result', success:false, error:{code, message}}` object, not an Error). Expected during reconnects.
 */
export function isHaConnectionLost(err: any): boolean {
    return err === ERR_CONNECTION_LOST || (err?.type === 'result' && err?.error?.code === ERR_CONNECTION_LOST);
}
