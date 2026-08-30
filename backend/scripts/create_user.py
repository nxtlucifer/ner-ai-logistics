"""Create a manager or admin account.

    python scripts/create_user.py --email you@example.com --role MANAGER --name "R. Baruah"

The password is read interactively and never taken from a command-line
argument: argv is visible to other processes and lands in shell history.

Drivers are not created here - a driver account is created together with their
profile through POST /api/drivers, so the two can never diverge.
"""

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.event_loop import configure_event_loop_policy  # noqa: E402

configure_event_loop_policy()

from sqlalchemy import func, select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.session import dispose_engine, get_sessionmaker  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.models.identity import User  # noqa: E402

MIN_PASSWORD_LENGTH = 12


async def main(email: str, role: UserRole, display_name: str, password: str) -> int:
    async with get_sessionmaker()() as session:
        existing = (
            await session.execute(
                select(User).where(func.lower(User.email) == email.lower())
            )
        ).scalar_one_or_none()
        if existing is not None:
            print(f"A user with email {email} already exists.", file=sys.stderr)
            return 1

        user = User(
            email=email,
            password_hash=hash_password(password),
            role=role,
            display_name=display_name,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        print(f"Created {role.value} {email} (id {user.id})")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a manager or admin account.")
    parser.add_argument("--email", required=True)
    parser.add_argument(
        "--role", default="MANAGER", choices=["MANAGER", "ADMIN"],
        help="DRIVER accounts are created via POST /api/drivers.",
    )
    parser.add_argument("--name", required=True, dest="display_name")
    args = parser.parse_args()

    pw = getpass.getpass("Password: ")
    if len(pw) < MIN_PASSWORD_LENGTH:
        print(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if pw != getpass.getpass("Confirm password: "):
        print("Passwords do not match.", file=sys.stderr)
        raise SystemExit(1)

    try:
        code = asyncio.run(
            main(args.email, UserRole(args.role), args.display_name, pw)
        )
    finally:
        asyncio.run(dispose_engine())
    raise SystemExit(code)
