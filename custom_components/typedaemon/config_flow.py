"""Config flow for TypeDaemon."""

from homeassistant import config_entries

from .const import DOMAIN


class TypeDaemonFlowHandler(config_entries.ConfigFlow, domain=DOMAIN):
    """Config flow for TypeDaemon."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle a user initiated set up flow."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="TypeDaemon", data={})
