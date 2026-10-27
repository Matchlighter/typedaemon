"""Tests for TypeDaemon stream cameras (typedaemon/camera/* websocket commands)."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx

from homeassistant.components.camera import CameraEntityFeature, async_get_image
from homeassistant.const import ATTR_SUPPORTED_FEATURES, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "typedaemon"
UID = "td-app1-stream_camera-door"
ENTITY_ID = "camera.app_device_front_door"
DEVICE = {
    "name": "App Device",
    "manufacturer": "TypeDaemon",
    "connections": [["td_app", "app1"]],
    "identifiers": ["td-app1"],
}


@pytest.fixture
async def ws(hass: HomeAssistant, hass_ws_client):
    """Set up the integration and return a websocket client."""
    assert await async_setup_component(hass, "camera", {})
    entry = MockConfigEntry(domain=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return await hass_ws_client(hass)


async def register(ws, **config):
    await ws.send_json_auto_id({
        "type": "typedaemon/camera/register",
        "unique_id": UID,
        "name": "Front Door",
        "device": DEVICE,
        **config,
    })
    msg = await ws.receive_json()
    assert msg["success"], msg
    return msg["id"]


async def command(ws, type_, **data):
    await ws.send_json_auto_id({"type": type_, **data})
    return await ws.receive_json()


def camera_entity(hass: HomeAssistant):
    return hass.data["camera"].get_entity(ENTITY_ID)


async def test_register_creates_streaming_camera(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/stream", attributes={"fps": 15})
    await hass.async_block_till_done()

    state = hass.states.get(ENTITY_ID)
    assert state is not None
    assert state.state != STATE_UNAVAILABLE
    assert state.attributes["fps"] == 15
    assert state.attributes[ATTR_SUPPORTED_FEATURES] == CameraEntityFeature.STREAM
    assert await camera_entity(hass).stream_source() == "rtsp://cam/stream"
    assert camera_entity(hass).use_stream_for_stills


async def test_camera_gets_a_device_mirroring_the_apps(hass: HomeAssistant, ws) -> None:
    # Devices are per config entry, so this is a TypeDaemon-integration twin of the app's MQTT device
    await register(ws, stream_source="rtsp://cam/stream")
    await hass.async_block_till_done()

    entry_id = hass.config_entries.async_entries(DOMAIN)[0].entry_id
    device = dr.async_get(hass).async_get_device_by_connection(("td_app", "app1"), entry_id)
    assert device is not None
    assert device.name == "App Device"
    assert device.identifiers == {(DOMAIN, "td-app1")}
    entry = er.async_get(hass).async_get(ENTITY_ID)
    assert entry.device_id == device.id


async def test_update_changes_stream_and_attributes(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/old")
    msg = await command(
        ws, "typedaemon/camera/update", unique_id=UID,
        stream_source="http://cam/live.m3u8", attributes={"quality": "hd"},
    )
    assert msg["success"], msg
    await hass.async_block_till_done()

    assert await camera_entity(hass).stream_source() == "http://cam/live.m3u8"
    assert hass.states.get(ENTITY_ID).attributes["quality"] == "hd"


async def test_clearing_stream_source_drops_stream_feature(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/old")
    assert (await command(ws, "typedaemon/camera/update", unique_id=UID, stream_source=None))["success"]
    await hass.async_block_till_done()

    assert hass.states.get(ENTITY_ID).attributes[ATTR_SUPPORTED_FEATURES] == 0
    assert await camera_entity(hass).stream_source() is None


async def test_source_changes_reach_a_running_stream(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/old")
    await hass.async_block_till_done()
    stream = MagicMock(stop=AsyncMock(), available=True)
    camera_entity(hass).stream = stream

    assert (await command(ws, "typedaemon/camera/update", unique_id=UID, stream_source="rtsp://cam/new"))["success"]
    stream.update_source.assert_called_once_with("rtsp://cam/new")

    assert (await command(ws, "typedaemon/camera/update", unique_id=UID, stream_source=None))["success"]
    await hass.async_block_till_done()
    stream.stop.assert_awaited_once()
    assert camera_entity(hass).stream is None


@respx.mock
async def test_still_image_url_is_used_for_snapshots(hass: HomeAssistant, ws) -> None:
    respx.get("http://cam/still.jpg").mock(return_value=httpx.Response(200, content=b"JPEG"))
    await register(ws, stream_source="rtsp://cam/stream", still_image_url="http://cam/still.jpg")
    await hass.async_block_till_done()

    assert not camera_entity(hass).use_stream_for_stills
    assert (await async_get_image(hass, ENTITY_ID)).content == b"JPEG"


async def test_update_unknown_camera_errors(hass: HomeAssistant, ws) -> None:
    msg = await command(ws, "typedaemon/camera/update", unique_id="nope", stream_source="rtsp://x")
    assert not msg["success"]
    assert msg["error"]["code"] == "not_found"


async def test_unsubscribe_marks_unavailable_until_reregistered(hass: HomeAssistant, ws) -> None:
    sub_id = await register(ws, stream_source="rtsp://cam/stream")
    assert (await command(ws, "unsubscribe_events", subscription=sub_id))["success"]
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state == STATE_UNAVAILABLE

    await register(ws, stream_source="rtsp://cam/new")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state != STATE_UNAVAILABLE
    assert await camera_entity(hass).stream_source() == "rtsp://cam/new"


async def test_connection_close_marks_unavailable(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/stream")
    await ws.close()
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state == STATE_UNAVAILABLE


async def test_superseded_registration_ending_keeps_camera_available(hass: HomeAssistant, ws) -> None:
    old_id = await register(ws, stream_source="rtsp://cam/stream")
    await register(ws, stream_source="rtsp://cam/stream")
    assert (await command(ws, "unsubscribe_events", subscription=old_id))["success"]
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state != STATE_UNAVAILABLE


async def test_remove_deletes_entity_and_registry_entry(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/stream")
    await hass.async_block_till_done()
    assert er.async_get(hass).async_get(ENTITY_ID) is not None

    assert (await command(ws, "typedaemon/camera/remove", unique_id=UID))["success"]
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID) is None
    assert er.async_get(hass).async_get(ENTITY_ID) is None


async def test_remove_unknown_camera_succeeds(hass: HomeAssistant, ws) -> None:
    assert (await command(ws, "typedaemon/camera/remove", unique_id="nope"))["success"]


async def test_requires_admin(hass: HomeAssistant, ws, hass_admin_user) -> None:
    hass_admin_user.groups = []
    msg = await command(ws, "typedaemon/camera/register", unique_id=UID, name="x")
    assert not msg["success"]
    assert msg["error"]["code"] == "unauthorized"


async def test_unload_entry(hass: HomeAssistant, ws) -> None:
    await register(ws, stream_source="rtsp://cam/stream")
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state == STATE_UNAVAILABLE
