"""Create/update dedicated classroom admin/mod accounts on presentation DB only.

Passwords come from the environment (never commit them). Hashes use UserService's
PasswordHash. Roles are written to the users.roles column — not inferred from
the login alias.

Usage (from apps/backend/src, with presentation DB selected):

  export MYSQL_DATABASE=questboard_presentation
  export CLASSROOM_DEMO_ADMIN_PASSWORD='…'
  export CLASSROOM_DEMO_MOD_PASSWORD='…'
  python -m jobs.ensure_classroom_demo_accounts \\
    --i-understand-this-targets-presentation-only
"""

from __future__ import annotations

import argparse
import os
import sys

PRESENTATION_DATABASE = "questboard_presentation"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_presentation_database() -> None:
    database = os.environ.get("MYSQL_DATABASE", "")
    if database != PRESENTATION_DATABASE:
        fail(
            f"refusing to run: MYSQL_DATABASE must be '{PRESENTATION_DATABASE}' "
            f"(got {database!r}). Will not touch other databases."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--i-understand-this-targets-presentation-only",
        action="store_true",
        required=True,
        help="Required confirmation that only questboard_presentation is targeted.",
    )
    parser.parse_args(argv)

    require_presentation_database()

    admin_password = os.environ.get("CLASSROOM_DEMO_ADMIN_PASSWORD", "")
    mod_password = os.environ.get("CLASSROOM_DEMO_MOD_PASSWORD", "")
    if not admin_password or not mod_password:
        fail(
            "set CLASSROOM_DEMO_ADMIN_PASSWORD and CLASSROOM_DEMO_MOD_PASSWORD "
            "(see docs/presentation/ACCOUNTS.local.md). Passwords are not committed."
        )

    # Import after the DB guard so a wrong database never constructs the engine first.
    from services.user_service import UserService
    from utilities.classroom_demo import CLASSROOM_DEMO_ADMIN_EMAIL
    from utilities.classroom_demo import CLASSROOM_DEMO_MOD_EMAIL
    from utilities.settings import load_database_settings

    settings = load_database_settings()
    if settings.database != PRESENTATION_DATABASE:
        fail("database settings escaped the presentation guard")

    users = UserService(settings)
    admin = users.ensure_user_with_roles(
        email=CLASSROOM_DEMO_ADMIN_EMAIL,
        name="Classroom Admin",
        password=admin_password,
        roles="student,admin",
    )
    mod = users.ensure_user_with_roles(
        email=CLASSROOM_DEMO_MOD_EMAIL,
        name="Classroom Moderator",
        password=mod_password,
        roles="student,moderator",
    )
    print(
        f"classroom demo accounts ready on {PRESENTATION_DATABASE}: "
        f"admin_id={admin.user_id} roles={admin.roles}; "
        f"mod_id={mod.user_id} roles={mod.roles}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
