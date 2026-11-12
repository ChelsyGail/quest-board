"""Route-level checks for student proof upload and submission (mocked services)."""

from datetime import datetime
from datetime import timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from api.app_factory import setup_app
from fastapi.testclient import TestClient
from models.users import UserRole
from services.proof_service import MediaRecord
from services.proof_service import NotYourParticipationError
from services.proof_service import SubmissionConflictError
from services.proof_service import SubmissionRecord
from utilities.media_types import MediaKind
from models.proof import SubmissionStatus

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def services():
    services = MagicMock()
    services.auth_service.decode_access_token.return_value = SimpleNamespace(user_id=3)
    services.auth_service.user_service.get_user.return_value = SimpleNamespace(
        user_id=3, roles=(UserRole.STUDENT,)
    )
    return services


@pytest.fixture
def client(services):
    return TestClient(setup_app(services))


def _media(media_id: int = 11) -> MediaRecord:
    return MediaRecord(
        media_id=media_id,
        owner_id=3,
        submission_id=None,
        content_type="image/png",
        kind=MediaKind.PHOTO,
        size_bytes=32,
        object_key=f"proof/3/{media_id}",
        uploaded_at=NOW,
    )


def _submission(submission_id: int = 21) -> SubmissionRecord:
    return SubmissionRecord(
        submission_id=submission_id,
        participation_id=9,
        item_id=5,
        user_id=3,
        attempt_number=1,
        text="Bag is full.",
        media=[_media(11)],
        status=SubmissionStatus.PENDING,
        submitted_at=NOW,
    )


def test_upload_returns_media_resource(client, services):
    services.proof_service.store_upload.return_value = _media()
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
    response = client.post(
        "/uploads",
        content=png,
        headers={**AUTH, "Content-Type": "image/png"},
    )
    assert response.status_code == 201, response.text
    body = response.json()["data"]
    assert body["type"] == "media"
    assert body["id"] == "11"
    assert body["attributes"]["kind"] == "photo"
    services.proof_service.store_upload.assert_called_once()


def test_submit_proof_returns_submission(client, services):
    services.proof_service.submit.return_value = _submission()
    response = client.post(
        "/participations/9/submissions",
        json={"text": "Bag is full.", "media_ids": [11]},
        headers=AUTH,
    )
    assert response.status_code == 201, response.text
    body = response.json()["data"]
    assert body["type"] == "submissions"
    assert body["attributes"]["status"] == "pending"
    assert body["attributes"]["participation_id"] == "9"
    assert body["attributes"]["media"][0]["id"] == "11"


def test_submit_conflict_returns_409(client, services):
    services.proof_service.submit.side_effect = SubmissionConflictError
    response = client.post(
        "/participations/9/submissions",
        json={"text": "Again"},
        headers=AUTH,
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["code"] == "submission_already_pending"


def test_list_submissions_rejects_other_student(client, services):
    services.proof_service.list_submissions.side_effect = NotYourParticipationError
    response = client.get("/participations/9/submissions", headers=AUTH)
    assert response.status_code == 403
    assert response.json()["errors"][0]["code"] == "participation_not_owned"


def test_proof_routes_require_auth(client):
    assert client.post("/uploads", content=b"x", headers={"Content-Type": "image/png"}).status_code == 401
    assert client.post("/participations/9/submissions", json={"text": "x"}).status_code == 401
    assert client.get("/participations/9/submissions").status_code == 401
