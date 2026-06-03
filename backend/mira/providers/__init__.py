"""
MIRA providers.

Provider selection is centralised here. Default is the safe, offline
``mock_provider``. The ``local_llm_stub`` is an inert interface for a future,
IT-approved local model runner and stays disabled unless explicitly enabled.
"""

from __future__ import annotations

from .. import config
from .mock_provider import MockMiraProvider
from .local_llm_stub import LocalLlmProviderStub


def get_provider():
    """Return the active provider instance based on config (defaults to mock)."""
    if config.PROVIDER_MODE == "local" and config.LOCAL_LLM_ENABLED:
        return LocalLlmProviderStub()
    # Any other value -> safe default.
    return MockMiraProvider()


__all__ = ["get_provider", "MockMiraProvider", "LocalLlmProviderStub"]
