"""Websocket API for TypeDaemon."""

import asyncio
import logging
from typing import Any
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.const import CONF_DESCRIPTION, CONF_ID, CONF_NAME, CONF_TYPE
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_set_service_schema

from .const import (
    CONF_CALL_ID,
    CONF_ERROR,
    CONF_FIELDS,
    CONF_RESPONSE,
    CONF_SERVICE,
    DATA_PENDING_CALLS,
    DATA_SERVICES,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


@callback
def register_websocket_handlers(hass: HomeAssistant) -> None:
    """Register the websocket handlers."""
    websocket_api.async_register_command(hass, websocket_register_action)
    websocket_api.async_register_command(hass, websocket_action_response)


@callback
def unregister_all_actions(hass: HomeAssistant) -> None:
    """Remove all actions registered by TypeDaemon connections."""
    for remove in list(hass.data[DOMAIN][DATA_SERVICES].values()):
        remove()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required(CONF_TYPE): "typedaemon/action/register",
        vol.Required(CONF_SERVICE): cv.slug,
        vol.Optional(CONF_NAME): cv.string,
        vol.Optional(CONF_DESCRIPTION): cv.string,
        vol.Optional(CONF_FIELDS, default={}): dict,
    }
)
@callback
def websocket_register_action(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Register an action and forward calls to this connection until unsubscribed."""
    service = msg[CONF_SERVICE]
    services: dict = hass.data[DOMAIN][DATA_SERVICES]
    pending_calls: dict[str, asyncio.Future] = hass.data[DOMAIN][DATA_PENDING_CALLS]

    if hass.services.has_service(DOMAIN, service):
        connection.send_error(
            msg[CONF_ID],
            "already_registered",
            f"Action {DOMAIN}.{service} is already registered",
        )
        return

    # Calls dispatched through this registration that are awaiting a response
    own_calls: set[str] = set()

    async def handle_call(call: ServiceCall) -> ServiceResponse:
        call_id = uuid.uuid4().hex
        future = hass.loop.create_future()
        pending_calls[call_id] = future
        own_calls.add(call_id)

        try:
            connection.send_message(
                websocket_api.event_message(
                    msg[CONF_ID],
                    {
                        CONF_CALL_ID: call_id,
                        "data": dict(call.data),
                        "context": call.context.as_dict(),
                        "return_response": call.return_response,
                    },
                )
            )
            response = await future
        finally:
            pending_calls.pop(call_id, None)
            own_calls.discard(call_id)

        if not call.return_response:
            return None
        return response or {}

    @callback
    def remove_action() -> None:
        # May be called both on integration unload and on connection close
        if services.get(service) is not remove_action:
            return
        del services[service]
        hass.services.async_remove(DOMAIN, service)

        for call_id in list(own_calls):
            future = pending_calls.get(call_id)
            if future and not future.done():
                future.set_exception(
                    HomeAssistantError(
                        f"TypeDaemon unregistered {DOMAIN}.{service} before responding"
                    )
                )

        _LOGGER.info("Action removed: %s.%s", DOMAIN, service)

    hass.services.async_register(
        DOMAIN,
        service,
        handle_call,
        supports_response=SupportsResponse.OPTIONAL,
    )
    async_set_service_schema(
        hass,
        DOMAIN,
        service,
        {
            CONF_NAME: msg.get(CONF_NAME, service),
            CONF_DESCRIPTION: msg.get(CONF_DESCRIPTION, ""),
            CONF_FIELDS: msg[CONF_FIELDS],
        },
    )
    services[service] = remove_action

    _LOGGER.info("Action registered: %s.%s", DOMAIN, service)
    connection.subscriptions[msg[CONF_ID]] = remove_action
    connection.send_result(msg[CONF_ID])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required(CONF_TYPE): "typedaemon/action/response",
        vol.Required(CONF_CALL_ID): cv.string,
        vol.Optional(CONF_RESPONSE): vol.Any(dict, None),
        vol.Optional(CONF_ERROR): cv.string,
    }
)
@callback
def websocket_action_response(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Complete a pending action call."""
    future = hass.data[DOMAIN][DATA_PENDING_CALLS].get(msg[CONF_CALL_ID])
    if future is None or future.done():
        connection.send_error(
            msg[CONF_ID], "not_found", f"No pending call {msg[CONF_CALL_ID]}"
        )
        return

    if CONF_ERROR in msg:
        future.set_exception(HomeAssistantError(msg[CONF_ERROR]))
    else:
        future.set_result(msg.get(CONF_RESPONSE))

    connection.send_result(msg[CONF_ID])
