from datetime import datetime
from datetime import timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from api.app_factory import setup_app
from fastapi.testclient import TestClient
from models.users import UserRole
from services.discussion_service import DiscussionAuthor
from services.discussion_service import NotAMemberError
from services.discussion_service import ThreadPage
from services.discussion_service import ThreadRecord

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def services():
    services = MagicMock()
    services.auth_service.decode_access_token.return_value = SimpleNamespace(user_id=3)
    services.auth_service.user_service.get_user.return_value = SimpleNamespace(
        user_id=3, roles=(UserRole.STUDENT,)
    )
    services.discussion_service = MagicMock()
    return services


@pytest.fixture
def client(services):
    return TestClient(setup_app(services))


def registered_routes(app) -> set[tuple[str, str]]:
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }


def test_discussion_routes_are_registered(services):
    routes = registered_routes(setup_app(services))
    for route in [
        ("GET", "/discussions/grove/threads"),
        ("POST", "/discussions/grove/threads"),
        ("GET", "/discussions/quests/{item_id}/spaces/{space}/threads"),
        ("POST", "/discussions/quests/{item_id}/spaces/{space}/threads"),
        ("GET", "/discussions/threads/{thread_id}"),
        ("POST", "/discussions/threads/{thread_id}/replies"),
    ]:
        assert route in routes


def test_grove_list_requires_auth(client):
    response = client.get("/discussions/grove/threads")
    assert response.status_code == 401


def test_grove_list_returns_threads(client, services):
    author = DiscussionAuthor(user_id=3, name="Sam")
    record = ThreadRecord(
        thread_id=9,
        scope="grove",
        title="Hello",
        category="general",
        body="Body",
        author=author,
        created_at=NOW,
        reply_count=0,
    )
    services.discussion_service.list_threads.return_value = ThreadPage(
        threads=[record],
        page_number=1,
        page_size=20,
        total_items=1,
        total_pages=1,
    )
    response = client.get("/discussions/grove/threads", headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["data"][0]["id"] == "9"
    assert body["data"][0]["attributes"]["scope"] == "grove"
    services.discussion_service.list_threads.assert_called_once()
    assert services.discussion_service.list_threads.call_args.args[1] == "grove"


def test_quest_active_list_maps_not_a_member(client, services):
    services.discussion_service.list_threads.side_effect = NotAMemberError
    response = client.get(
        "/discussions/quests/5/spaces/active/threads", headers=AUTH
    )
    assert response.status_code == 403
    assert response.json()["errors"][0]["code"] == "not_a_member"