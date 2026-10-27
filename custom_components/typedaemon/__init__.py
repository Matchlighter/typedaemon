"""TypeDaemon companion integration.

Exposes Websocket commands that allow TypeDaemon to register Home Assistant actions (services)
under the `typedaemon` domain and handle them remotely, and to provide stream cameras (camera platform).
"""

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import DATA_CAMERAS, DATA_PENDING_CALLS, DATA_SERVICES, DOMAIN
from .websocket import register_websocket_handlers, unregister_all_actions

PLATFORMS = [Platform.CAMERA]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up TypeDaemon from a config entry."""
    hass.data[DOMAIN] = {
        DATA_SERVICES: {},
        DATA_PENDING_CALLS: {},
        DATA_CAMERAS: {},
    }
    # Platforms first so cameras can be added as soon as TypeDaemon can register them
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    register_websocket_handlers(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    unregister_all_actions(hass)
    hass.data.pop(DOMAIN, None)
    return unload_ok
