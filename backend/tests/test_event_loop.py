"""Tests for the Windows event loop policy fix.

Regression guard. Without the selector policy, every async psycopg call on Windows
fails with an InterfaceError, which takes the whole backend down locally. See
app/core/event_loop.py.
"""

import asyncio
import sys

import pytest

from app.core.event_loop import (
    configure_event_loop_policy,
    running_loop_supports_psycopg,
)


class TestConfigureEventLoopPolicy:
    def test_is_idempotent(self) -> None:
        """conftest already applied it, so a second call must report no change."""
        assert configure_event_loop_policy() is False

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-only policy")
    def test_selector_policy_is_active_on_windows(self) -> None:
        assert isinstance(
            asyncio.get_event_loop_policy(), asyncio.WindowsSelectorEventLoopPolicy
        )

    @pytest.mark.skipif(sys.platform == "win32", reason="non-Windows behaviour")
    def test_noop_off_windows(self) -> None:
        assert configure_event_loop_policy() is False


class TestRunningLoopCheck:
    async def test_reports_supported_under_test_loop(self) -> None:
        """The loop these tests run on must be one psycopg can use."""
        assert running_loop_supports_psycopg() is True

    def test_reports_supported_with_no_running_loop(self) -> None:
        """Outside a loop there is nothing to object to."""
        assert running_loop_supports_psycopg() is True
