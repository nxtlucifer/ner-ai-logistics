"""The migration chain has exactly one head.

Two branches each added a `0013` on top of `0012_push_notifications`
(`0013_state_district_inbox` here, `0013_device_events` on
claude/pdf-master-mission-gohuj5). Merged as-is, Alembic would have two heads
and `upgrade head` would refuse - on the hosted database, at deploy time. This
fails the moment such a fork lands, long before that.
"""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]


def test_the_migration_chain_has_one_head():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"more than one Alembic head: {heads}"
