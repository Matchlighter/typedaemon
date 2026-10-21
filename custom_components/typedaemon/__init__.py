"""TypeDaemon companion integration.

Exposes Websocket commands that allow TypeDaemon to register Home Assistant actions (services)
under the `typedaemon` domain and handle them remotely.
"""

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DATA_PENDING_CALLS, DATA_SERVICES, DOMAIN
from .websocket import register_websocket_handlers, unregister_all_actions


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up TypeDaemon from a config entry."""
    hass.data[DOMAIN] = {
        DATA_SERVICES: {},
        DATA_PENDING_CALLS: {},
    }
    register_websocket_handlers(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unregister_all_actions(hass)
    hass.data.pop(DOMAIN, None)
    return True
