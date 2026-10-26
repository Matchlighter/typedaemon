"""Stream cameras registered by TypeDaemon over the websocket API.

MQTT cameras can only carry still images, so TypeDaemon registers cameras with a stream URL here instead
(`typedaemon/camera/*` websocket commands, see websocket.py). HA's `stream` integration turns the URL into HLS/WebRTC.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.httpx_client import get_async_client

from .const import (
    CONF_ATTRIBUTES,
    CONF_DEVICE,
    CONF_STILL_IMAGE_URL,
    CONF_STREAM_SOURCE,
    CONF_UNIQUE_ID,
    DATA_ADD_CAMERAS,
    DATA_CAMERAS,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

GET_IMAGE_TIMEOUT = 10

# Keys of TypeDaemon's device description passed through to DeviceInfo verbatim
_DEVICE_PASSTHROUGH = ("name", "manufacturer", "model", "sw_version", "configuration_url")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the camera platform; cameras are added later as TypeDaemon registers them."""
    hass.data[DOMAIN][DATA_ADD_CAMERAS] = async_add_entities


def device_info_from_td(device: dict[str, Any] | None) -> DeviceInfo | None:
    """Convert TypeDaemon's (MQTT-discovery style) device description to DeviceInfo.

    Devices belong to a single config entry (HA >= 2026.x), so this yields a TypeDaemon-integration device mirroring the
    app's MQTT device (same name/identifiers/connections) rather than the MQTT device itself.
    """
    if not device:
        return None
    info = DeviceInfo()
    identifiers = device.get("identifiers")
    if isinstance(identifiers, str):
        identifiers = [identifiers]
    if identifiers:
        info["identifiers"] = {(DOMAIN, str(i)) for i in identifiers}
    if connections := device.get("connections"):
        info["connections"] = {(str(c[0]), str(c[1])) for c in connections}
    for key in _DEVICE_PASSTHROUGH:
        if device.get(key) is not None:
            info[key] = device[key]
    if "identifiers" not in info and "connections" not in info:
        return None
    return info


class TypeDaemonCamera(Camera):
    """A camera whose stream source is pushed by TypeDaemon."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, config: dict[str, Any]) -> None:
        """Initialize the camera."""
        super().__init__()
        self.hass = hass
        self._attr_unique_id = config[CONF_UNIQUE_ID]
        self._attr_device_info = device_info_from_td(config.get(CONF_DEVICE))
        self._stream_source: str | None = None
        self._still_image_url: str | None = None
        self._last_image: bytes | None = None
        # Token of the websocket registration currently backing this camera; unavailable while None
        self.owner: object | None = None
        self._attr_available = False
        self.apply_config(config)

    @callback
    def apply_config(self, config: dict[str, Any]) -> None:
        """Apply (a subset of) the TypeDaemon config. Keys absent from `config` are left unchanged."""
        if "name" in config:
            self._attr_name = config["name"]
        if CONF_ATTRIBUTES in config:
            self._attr_extra_state_attributes = config[CONF_ATTRIBUTES] or {}
        if CONF_STILL_IMAGE_URL in config:
            self._still_image_url = config[CONF_STILL_IMAGE_URL] or None
        if CONF_STREAM_SOURCE in config:
            self._set_stream_source(config[CONF_STREAM_SOURCE] or None)

    @callback
    def _set_stream_source(self, source: str | None) -> None:
        if source == self._stream_source:
            return
        self._stream_source = source
        self._attr_supported_features = (
            CameraEntityFeature.STREAM if source else CameraEntityFeature(0)
        )
        if self.stream is None:
            return
        if source:
            self.stream.update_source(source)
        else:
            stream, self.stream = self.stream, None
            self.hass.async_create_task(stream.stop())

    @callback
    def async_update_config(self, config: dict[str, Any]) -> None:
        """Apply a config update from TypeDaemon and write the new state."""
        self.apply_config(config)
        self._async_write_if_added()

    @callback
    def set_owner(self, owner: object | None) -> None:
        """Mark which registration backs this camera (None: TypeDaemon disconnected)."""
        self.owner = owner
        self._attr_available = owner is not None
        self._async_write_if_added()

    @callback
    def _async_write_if_added(self) -> None:
        if self.hass is not None and self.entity_id:
            self.async_write_ha_state()

    @property
    def use_stream_for_stills(self) -> bool:
        """Grab stills from the stream unless TypeDaemon gave a still image URL."""
        return not self._still_image_url and bool(self._stream_source)

    async def stream_source(self) -> str | None:
        """Return the stream URL pushed by TypeDaemon."""
        return self._stream_source

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Fetch a still from the still image URL, if one was given."""
        if not self._still_image_url:
            return None
        try:
            response = await get_async_client(self.hass).get(
                self._still_image_url,
                follow_redirects=True,
                timeout=GET_IMAGE_TIMEOUT,
            )
            response.raise_for_status()
            self._last_image = response.content
        except Exception as err:  # noqa: BLE001 - HTTP client exception types vary across HA versions
            _LOGGER.warning("Error fetching still image for %s: %s", self.entity_id, err)
        return self._last_image


@callback
def async_upsert_camera(
    hass: HomeAssistant, config: dict[str, Any], owner: object
) -> TypeDaemonCamera:
    """Create the camera, or update and take over an existing one, backed by registration `owner`."""
    cameras: dict[str, TypeDaemonCamera] = hass.data[DOMAIN][DATA_CAMERAS]
    unique_id = config[CONF_UNIQUE_ID]
    if camera := cameras.get(unique_id):
        camera.apply_config(config)
        camera.set_owner(owner)  # Writes state
        return camera

    camera = TypeDaemonCamera(hass, config)
    camera.set_owner(owner)
    cameras[unique_id] = camera
    hass.data[DOMAIN][DATA_ADD_CAMERAS]([camera])
    return camera


async def async_remove_camera(hass: HomeAssistant, unique_id: str) -> None:
    """Remove a camera and its entity registry entry. Also works for cameras not registered since HA started."""
    camera: TypeDaemonCamera | None = hass.data[DOMAIN][DATA_CAMERAS].pop(unique_id, None)
    registry = er.async_get(hass)
    if entity_id := registry.async_get_entity_id("camera", DOMAIN, unique_id):
        # Removing the registry entry also removes a loaded entity
        registry.async_remove(entity_id)
    elif camera is not None and camera.hass is not None and camera.entity_id:
        await camera.async_remove(force_remove=True)
