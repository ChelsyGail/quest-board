"""Classroom-demo login aliases (opt-in).

When QUESTBOARD_CLASSROOM_DEMO is enabled, the login form may send the
short identifiers ``admin`` / ``mod``. Those resolve to dedicated demo
account emails below. Roles and passwords still come from the users table
(hashed); nothing elevates privileges from the typed alias alone.
"""

from __future__ import annotations

# Stable emails for the two dedicated classroom accounts (presentation DB).
CLASSROOM_DEMO_ADMIN_EMAIL = "admin@questboard.demo"
CLASSROOM_DEMO_MOD_EMAIL = "mod@questboard.demo"

CLASSROOM_DEMO_ALIASES: dict[str, str] = {
    "admin": CLASSROOM_DEMO_ADMIN_EMAIL,
    "mod": CLASSROOM_DEMO_MOD_EMAIL,
}

CLASSROOM_DEMO_EMAILS: frozenset[str] = frozenset(CLASSROOM_DEMO_ALIASES.values())


def normalize_login_identifier(raw: str) -> str:
    return (raw or "").strip()


def resolve_classroom_login_email(identifier: str, *, enabled: bool) -> str | None:
    """Return the account email for a login identifier, or None if disallowed.

    - Classroom mode on: aliases map to dedicated emails; dedicated emails pass
      through; any other value is returned unchanged for normal email login.
    - Classroom mode off: aliases are rejected (None); dedicated demo emails are
      rejected (None); other identifiers pass through unchanged.
    """
    value = normalize_login_identifier(identifier)
    if not value:
        return None

    alias_key = value.lower()
    if alias_key in CLASSROOM_DEMO_ALIASES:
        return CLASSROOM_DEMO_ALIASES[alias_key] if enabled else None

    if value.lower() in {email.lower() for email in CLASSROOM_DEMO_EMAILS}:
        # Canonicalize to the configured email casing.
        for email in CLASSROOM_DEMO_EMAILS:
            if email.lower() == value.lower():
                return email if enabled else None
        return None

    return value
