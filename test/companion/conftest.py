"""Pytest setup for the companion integration (pytest-homeassistant-custom-component)."""

from pathlib import Path
import sys
import types

import pytest

# The repo's custom_components/ is a namespace package, which loses to the regular `custom_components` package
# pytest-homeassistant-custom-component ships (testing_config/). Pin the package HA's loader imports to the repo's dir.
_custom_components = types.ModuleType("custom_components")
_custom_components.__path__ = [str(Path(__file__).resolve().parents[2] / "custom_components")]
sys.modules["custom_components"] = _custom_components


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load custom_components/ from the repo root."""
    yield
