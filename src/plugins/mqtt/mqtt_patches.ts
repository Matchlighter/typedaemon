
import * as mqtt from "mqtt";
const debug = require('debug')('mqttjs:client')

// @ts-ignore
mqtt.MqttClient.prototype._setupReconnect = function () {
    const that = this

    if (!that.disconnecting && !that.reconnectTimer && (that.options.reconnectPeriod > 0)) {
        if (!this.reconnecting) {
            debug('_setupReconnect :: emit `offline` state')
            this.emit('offline')
            debug('_setupReconnect :: set `reconnecting` to `true`')
            this.reconnecting = true
            this._reconnect_tries = 0;
        }

        // Implement exponential backoff
        let reconnectTime = that.options.reconnectPeriod;
        reconnectTime = reconnectTime * (1.2 ^ this._reconnect_tries);
        reconnectTime = Math.min(reconnectTime, 30_000);

        this._reconnect_tries += 1;

        debug('_setupReconnect :: setting reconnectTimer for %d ms', reconnectTime)
        that.reconnectTimer = setInterval(function () {
            debug('reconnectTimer :: reconnect triggered!')
            that._reconnect()
        }, reconnectTime)
    } else {
        debug('_setupReconnect :: doing nothing...')
    }
}
