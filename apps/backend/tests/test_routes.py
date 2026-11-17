from datetime import datetime
from datetime import timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from api.app_factory import setup_app
from fastapi.testclient import TestClient
from models.catalogue import ItemKind
from models.catalogue import ItemStatus
from models.catalogue import ParticipationStatus
from models.users import UserRole
from services.catalogue_service import ItemAlreadyPublishedError
from services.catalogue_service import ItemArchivedError
from services.catalogue_service import ItemOwnershipError
from services.catalogue_service import ItemPage
from services.catalogue_service import ItemRecord
from services.participation_service import AlreadyJoinedError
from services.participation_service import ItemNotAvailableError
from services.participation_service import MyItemRecord
from services.participation_service import ParticipationRecord

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)
AUTH = {"Authorization": "Bearer test-token"}


def make_item(**changes) -> ItemRecord:
    fields = dict(
        item_id=5,
        owner_id=7,
        kind=ItemKind.QUEST,
        title="Campus cleanup",
        description="Pick up litter.",
        location="Quai d'Orsay",
        starts_at=datetime(2026, 11, 10, 13, 0, tzinfo=timezone.utc),
        ends_at=datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc),
        time_zone="Europe/Paris",
        category="Volunteering",
        proof_instructions="A photo of your bag.",
        point_value=50,
        status=ItemStatus.PUBLISHED,
        published_at=NOW,
        archived_at=None,
        created_at=NOW,
        updated_at=NOW,
    )
    fields.update(changes)
    return ItemRecord(**fields)


@pytest.fixture
def services():
    services = MagicMock()
    services.auth_service.decode_access_token.return_value = SimpleNamespace(user_id=3)
    services.auth_service.user_service.get_user.return_value = SimpleNamespace(
        user_id=3, roles=(UserRole.STUDENT, UserRole.ORGANIZER)
    )
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


def test_catalogue_and_participation_routes_are_registered(services):
    routes = registered_routes(setup_app(services))
    for route in [
        ("POST", "/quests"),
        ("POST", "/events"),
        ("GET", "/items"),
        ("GET", "/items/me"),
        ("GET", "/items/{item_id}"),
        ("PATCH", "/items/{item_id}"),
        ("POST", "/items/{item_id}/publish"),
        ("GET", "/items/{item_id}/participants"),
        ("POST", "/items/{item_id}/join"),
        ("GET", "/me/participations"),
    ]:
        assert route in routes


def test_setup_services_builds_the_participation_service(monkeypatch):
    from services.participation_service import ParticipationService
    from utilities.services import setup_services

    for name, value in {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_USER": "nobody",
        "MYSQL_PASSWORD": "unused",
        "MYSQL_DATABASE": "unused",
        "JWT_SECRET_KEY": "unused",
    }.items():
        monkeypatch.setenv(name, value)

    assert isinstance(setup_services().participation_service, ParticipationService)


def test_participation_routes_require_a_token(client):
    assert client.post("/items/5/join").status_code == 401
    assert client.get("/me/participations").status_code == 401


def test_join_returns_the_participation(client, services):
    services.participation_service.join_item.return_value = ParticipationRecord(
        participation_id=11,
        user_id=3,
        item_id=5,
        status=ParticipationStatus.JOINED,
        joined_at=NOW,
    )

    response = client.post("/items/5/join", headers=AUTH)

    assert response.status_code == 201
    assert response.json()["data"] == {
        "type": "participations",
        "id": "11",
        "attributes": {
            "item_id": "5",
            "user_id": "3",
            "status": "joined",
            "joined_at": "2026-11-04T12:00:00Z",
        },
    }
    services.participation_service.join_item.assert_called_once_with(3, 5)


def test_duplicate_join_is_a_409_with_its_own_code(client, services):
    services.participation_service.join_item.side_effect = AlreadyJoinedError

    response = client.post("/items/5/join", headers=AUTH)

    assert response.status_code == 409
    assert response.json()["errors"][0]["code"] == "already_joined"


def test_joining_an_unavailable_item_is_a_404(client, services):
    services.participation_service.join_item.side_effect = ItemNotAvailableError

    response = client.post("/items/5/join", headers=AUTH)

    assert response.status_code == 404
    assert response.json()["errors"][0]["code"] == "item_not_found"


def test_my_participations_nest_the_participation_in_each_item(client, services):
    services.participation_service.list_my_items.return_value = [
        MyItemRecord(
            item=make_item(),
            participation=ParticipationRecord(
                participation_id=11,
                user_id=3,
                item_id=5,
                status=ParticipationStatus.JOINED,
                joined_at=NOW,
            ),
            saved=False,
        ),
        MyItemRecord(item=make_item(item_id=6), participation=None, saved=True),
    ]

    response = client.get("/me/participations", headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert [entry["id"] for entry in body["data"]] == ["5", "6"]
    joined = body["data"][0]["attributes"]
    assert joined["participation"]["status"] == "joined"
    assert joined["participation"]["participation_id"] == "11"
    assert "participation" not in body["data"][1]["attributes"]
    assert body["meta"] == {"count": 2, "joined_count": 1, "saved_count": 1}


def test_publish_conflicts_keep_distinct_codes(client, services):
    services.catalogue_service.publish_item.side_effect = ItemAlreadyPublishedError
    already = client.post("/items/5/publish", headers=AUTH)
    services.catalogue_service.publish_item.side_effect = ItemArchivedError
    archived = client.post("/items/5/publish", headers=AUTH)

    assert already.status_code == archived.status_code == 409
    assert already.json()["errors"][0]["code"] == "item_already_published"
    assert archived.json()["errors"][0]["code"] == "item_archived"


def test_publishing_someone_elses_item_is_forbidden(client, services):
    services.catalogue_service.publish_item.side_effect = ItemOwnershipError

    response = client.post("/items/5/publish", headers=AUTH)

    assert response.status_code == 403
    assert response.json()["errors"][0]["code"] == "item_not_owned"


def page_of(*items) -> ItemPage:
    return ItemPage(items=list(items), page_number=2, page_size=12, total_items=13)


def test_item_list_reports_page_meta_and_passes_filters(client, services):
    services.catalogue_service.list_published_items.return_value = page_of(make_item())

    response = client.get(
        "/items",
        params={"page": 2, "page_size": 12, "q": "  litter ", "category": "Sports"},
        headers=AUTH,
    )

    assert response.status_code == 200
    assert response.json()["meta"] == {
        "page": {"number": 2, "size": 12, "total_items": 13, "total_pages": 2}
    }
    page, size, filters = services.catalogue_service.list_published_items.call_args.args
    assert (page, size) == (2, 12)
    assert filters.keyword == "litter"
    assert filters.category == "Sports"
    assert filters.window_start is None and filters.window_end is None


def test_item_list_accepts_a_window_in_the_students_time_zone(client, services):
    services.catalogue_service.list_published_items.return_value = page_of()

    # 29 March 2026 in Paris: 23 hours long, because clocks go forward.
    response = client.get(
        "/items",
        params={
            "window_start": "2026-03-29T00:00:00+01:00",
            "window_end": "2026-03-29T23:59:59.999+02:00",
        },
        headers=AUTH,
    )

    assert response.status_code == 200
    filters = services.catalogue_service.list_published_items.call_args.args[2]
    assert filters.window_start == datetime(2026, 3, 28, 23, 0, tzinfo=timezone.utc)
    assert filters.window_end.astimezone(timezone.utc) == datetime(
        2026, 3, 29, 21, 59, 59, 999000, tzinfo=timezone.utc
    )


def test_item_list_keeps_the_narrower_of_day_and_instant_bounds(client, services):
    services.catalogue_service.list_published_items.return_value = page_of()

    client.get(
        "/items",
        params={
            "from": "2026-11-10",
            "to": "2026-11-12",
            "window_start": "2026-11-09T12:00:00Z",
            "window_end": "2026-11-11T12:00:00Z",
        },
        headers=AUTH,
    )

    filters = services.catalogue_service.list_published_items.call_args.args[2]
    assert filters.window_start == datetime(2026, 11, 10, tzinfo=timezone.utc)
    assert filters.window_end == datetime(2026, 11, 11, 12, tzinfo=timezone.utc)


def test_item_list_rejects_naive_or_reversed_windows(client, services):
    naive = client.get("/items", params={"window_start": "2026-11-10T00:00:00"}, headers=AUTH)
    reversed_window = client.get(
        "/items",
        params={
            "window_start": "2026-11-10T00:00:00Z",
            "window_end": "2026-11-09T00:00:00Z",
        },
        headers=AUTH,
    )

    assert naive.status_code == 422
    assert reversed_window.status_code == 422
    assert reversed_window.json()["errors"][0]["code"] == "invalid_date_range"
    services.catalogue_service.list_published_items.assert_not_called()
