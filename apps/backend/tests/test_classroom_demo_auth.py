"""Classroom-demo login aliases — unit tests (no DB)."""

from __future__ import annotations

from datetime import datetime
from datetime import timezone
from unittest.mock import MagicMock

import pytest
from models.auth import LoginRequest
from models.users import AttendanceVisibility
from models.users import UserCreate
from models.users import UserRole
from models.users import UserUpdate
from pydantic import ValidationError
from services.auth_service import AuthService
from services.auth_service import InvalidCredentialsError
from services.user_service import UserCredentials
from services.user_service import UserRecord
from utilities.classroom_demo import CLASSROOM_DEMO_ADMIN_EMAIL
from utilities.classroom_demo import CLASSROOM_DEMO_MOD_EMAIL
from utilities.classroom_demo import resolve_classroom_login_email
from utilities.settings import AuthSettings


def _settings(*, classroom: bool) -> AuthSettings:
    return AuthSettings(
        secret_key="test-secret",
        algorithm="HS256",
        access_token_expires_minutes=60,
        classroom_demo_enabled=classroom,
    )


def _record(*, email: str, roles: tuple[UserRole, ...]) -> UserRecord:
    now = datetime.now(timezone.utc)
    return UserRecord(
        user_id=42,
        email=email,
        name="Demo",
        roles=roles,
        attendance_visibility=AttendanceVisibility.VISIBLE,
        created_at=now,
        updated_at=now,
    )


def test_resolve_aliases_only_when_enabled():
    assert resolve_classroom_login_email("admin", enabled=True) == CLASSROOM_DEMO_ADMIN_EMAIL
    assert resolve_classroom_login_email("MOD", enabled=True) == CLASSROOM_DEMO_MOD_EMAIL
    assert resolve_classroom_login_email("admin", enabled=False) is None
    assert resolve_classroom_login_email("mod", enabled=False) is None


def test_resolve_dedicated_emails_only_when_enabled():
    assert (
        resolve_classroom_login_email(CLASSROOM_DEMO_ADMIN_EMAIL, enabled=True)
        == CLASSROOM_DEMO_ADMIN_EMAIL
    )
    assert resolve_classroom_login_email(CLASSROOM_DEMO_ADMIN_EMAIL, enabled=False) is None
    assert resolve_classroom_login_email(CLASSROOM_DEMO_MOD_EMAIL, enabled=False) is None


def test_resolve_normal_email_passthrough_regardless_of_flag():
    assert (
        resolve_classroom_login_email("maya.chen@aup.edu", enabled=False)
        == "maya.chen@aup.edu"
    )
    assert (
        resolve_classroom_login_email("maya.chen@aup.edu", enabled=True)
        == "maya.chen@aup.edu"
    )


def test_login_request_accepts_alias_and_short_password_without_lowering_signup_rules():
    LoginRequest(email="admin", password="admin")
    LoginRequest(email="mod", password="mod")
    with pytest.raises(ValidationError):
        UserCreate(
            email="someone@aup.edu",
            name="Someone",
            password="short",
        )
    with pytest.raises(ValidationError):
        UserUpdate(password="short")


def test_authenticate_alias_uses_hashed_password_and_stored_roles():
    user_service = MagicMock()
    record = _record(
        email=CLASSROOM_DEMO_ADMIN_EMAIL, roles=(UserRole.ADMIN, UserRole.STUDENT)
    )
    user_service.get_credentials_by_email.return_value = UserCredentials(
        record=record, password_hash="hash"
    )
    user_service.verify_password.return_value = True
    auth = AuthService(_settings(classroom=True), user_service)

    got = auth.authenticate("admin", "admin")
    assert got.email == CLASSROOM_DEMO_ADMIN_EMAIL
    assert UserRole.ADMIN in got.roles
    user_service.get_credentials_by_email.assert_called_once_with(
        CLASSROOM_DEMO_ADMIN_EMAIL
    )
    user_service.verify_password.assert_called_once_with("admin", "hash")


def test_authenticate_rejects_alias_when_classroom_disabled():
    user_service = MagicMock()
    auth = AuthService(_settings(classroom=False), user_service)
    with pytest.raises(InvalidCredentialsError):
        auth.authenticate("admin", "admin")
    user_service.get_credentials_by_email.assert_not_called()


def test_authenticate_rejects_dedicated_email_when_classroom_disabled():
    user_service = MagicMock()
    auth = AuthService(_settings(classroom=False), user_service)
    with pytest.raises(InvalidCredentialsError):
        auth.authenticate(CLASSROOM_DEMO_ADMIN_EMAIL, "admin")
    user_service.get_credentials_by_email.assert_not_called()


def test_authenticate_wrong_password_fails_even_in_classroom_mode():
    user_service = MagicMock()
    record = _record(
        email=CLASSROOM_DEMO_MOD_EMAIL, roles=(UserRole.MODERATOR, UserRole.STUDENT)
    )
    user_service.get_credentials_by_email.return_value = UserCredentials(
        record=record, password_hash="hash"
    )
    user_service.verify_password.return_value = False
    auth = AuthService(_settings(classroom=True), user_service)
    with pytest.raises(InvalidCredentialsError):
        auth.authenticate("mod", "nope")


def test_authenticate_does_not_grant_roles_from_typed_alias_alone():
    """Roles come from the stored user row after password verify — not from 'admin' text."""
    user_service = MagicMock()
    # Misconfigured row: alias admin maps to email, but DB roles are student-only.
    record = _record(email=CLASSROOM_DEMO_ADMIN_EMAIL, roles=(UserRole.STUDENT,))
    user_service.get_credentials_by_email.return_value = UserCredentials(
        record=record, password_hash="hash"
    )
    user_service.verify_password.return_value = True
    auth = AuthService(_settings(classroom=True), user_service)
    got = auth.authenticate("admin", "admin")
    assert got.roles == (UserRole.STUDENT,)
    assert UserRole.ADMIN not in got.roles
