"""End-to-end checks of the real app against a MySQL database with every schema file applied.

Opt-in: set QUESTBOARD_INTEGRATION=1 plus the usual MYSQL_* and JWT_* variables. Each run
adds its own users and items under a unique category and never deletes anything, so it is
safe on a shared development database.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    os.environ.get("QUESTBOARD_INTEGRATION") != "1",
    reason="set QUESTBOARD_INTEGRATION=1 to run against a real database",
)

PASSWORD = "integration-password-1"


@pytest.fixture(scope="module")
def world():
    from api.app_factory import setup_app
    from utilities.services import setup_services

    services = setup_services()
    client = TestClient(setup_app(services))
    run = uuid.uuid4().hex[:8]

    def account(label: str, organizer: bool = False) -> dict:
        email = f"it-{run}-{label}@example.com"
        created = client.post(
            "/users", json={"name": f"IT {label}", "email": email, "password": PASSWORD}
        )
        assert created.status_code == 201, created.text
        if organizer:
            with services.user_service.engine.begin() as connection:
                connection.execute(
                    text("UPDATE users SET roles = 'student,organizer' WHERE email = :email"),
                    {"email": email},
                )
        login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
        token = login.json()["data"]["attributes"]["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return {
        "client": client,
        "services": services,
        "category": f"it-{run}",
        "organizer": account("organizer", organizer=True),
        "other_organizer": account("other", organizer=True),
        "student": account("student"),
        "student_b": account("student-b"),
        "run": run,
    }


def quest_body(category: str, title: str, starts_at: str, ends_at: str) -> dict:
    return {
        "title": title,
        "description": "Integration check",
        "location": "Combes field",
        "starts_at": starts_at,
        "ends_at": ends_at,
        "time_zone": "Europe/Paris",
        "category": category,
        "proof_instructions": "A photo",
        "point_value": 10,
    }


def create_published(world, title: str, starts_at: str, ends_at: str) -> str:
    client = world["client"]
    created = client.post(
        "/quests",
        json=quest_body(world["category"], title, starts_at, ends_at),
        headers=world["organizer"],
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["data"]["id"]
    published = client.post(f"/items/{item_id}/publish", headers=world["organizer"])
    assert published.status_code == 200, published.text
    return item_id


def test_draft_publish_join_flow(world):
    client = world["client"]
    created = client.post(
        "/quests",
        json=quest_body(
            world["category"], "Flow quest", "2028-05-02T10:00:00+02:00", "2028-05-02T12:00:00+02:00"
        ),
        headers=world["organizer"],
    )
    assert created.status_code == 201
    item = created.json()["data"]
    assert item["attributes"]["status"] == "draft"
    item_id = item["id"]

    mine = client.get("/items/me", headers=world["organizer"]).json()["data"]
    assert item_id in [entry["id"] for entry in mine]

    # Drafts are invisible to students and cannot be joined.
    assert client.get(f"/items/{item_id}", headers=world["student"]).status_code == 404
    assert client.post(f"/items/{item_id}/join", headers=world["student"]).status_code == 404

    # Another organizer can neither publish nor edit it.
    other_publish = client.post(f"/items/{item_id}/publish", headers=world["other_organizer"])
    other_edit = client.patch(
        f"/items/{item_id}", json={"title": "Hijacked"}, headers=world["other_organizer"]
    )
    assert other_publish.status_code == other_edit.status_code == 403
    assert other_publish.json()["errors"][0]["code"] == "item_not_owned"

    published = client.post(f"/items/{item_id}/publish", headers=world["organizer"])
    assert published.status_code == 200
    assert published.json()["data"]["attributes"]["status"] == "published"
    again = client.post(f"/items/{item_id}/publish", headers=world["organizer"])
    assert again.status_code == 409
    assert again.json()["errors"][0]["code"] == "item_already_published"

    detail = client.get(f"/items/{item_id}", headers=world["student"])
    assert detail.status_code == 200
    assert detail.json()["data"]["attributes"]["title"] == "Flow quest"

    joined = client.post(f"/items/{item_id}/join", headers=world["student"])
    assert joined.status_code == 201
    assert joined.json()["data"]["attributes"]["item_id"] == item_id
    duplicate = client.post(f"/items/{item_id}/join", headers=world["student"])
    assert duplicate.status_code == 409
    assert duplicate.json()["errors"][0]["code"] == "already_joined"

    participations = client.get("/me/participations", headers=world["student"]).json()
    entry = next(e for e in participations["data"] if e["id"] == item_id)
    assert entry["attributes"]["participation"]["status"] == "joined"

    participants = client.get(f"/items/{item_id}/participants", headers=world["organizer"])
    assert participants.json()["meta"]["count"] == 1
    assert (
        client.get(f"/items/{item_id}/participants", headers=world["other_organizer"]).status_code
        == 403
    )


def test_pages_cover_every_matching_item_once(world):
    client = world["client"]
    expected = [
        create_published(
            world,
            f"Paged quest {number:02d}",
            f"2028-06-{number:02d}T09:00:00Z",
            f"2028-06-{number:02d}T10:00:00Z",
        )
        for number in range(1, 26)
    ]

    seen = []
    for page in (1, 2, 3):
        body = client.get(
            "/items",
            params={"category": world["category"], "q": "Paged", "page": page, "page_size": 10},
            headers=world["student"],
        ).json()
        assert body["meta"]["page"]["total_items"] == 25
        assert body["meta"]["page"]["total_pages"] == 3
        seen += [entry["id"] for entry in body["data"]]

    assert seen == expected

    keyword = client.get(
        "/items",
        params={"category": world["category"], "q": "quest 2"},
        headers=world["student"],
    ).json()
    assert keyword["meta"]["page"]["total_items"] == 6  # 20 to 25


def test_local_day_window_across_daylight_saving_change(world):
    client = world["client"]
    # Paris clocks go forward on 26 March 2028, so that day starts at +01:00 and ends at +02:00.
    early = create_published(
        world, "DST early", "2028-03-26T00:30:00+01:00", "2028-03-26T01:30:00+01:00"
    )
    late = create_published(
        world, "DST late", "2028-03-26T23:30:00+02:00", "2028-03-27T00:30:00+02:00"
    )
    next_day = create_published(
        world, "DST next day", "2028-03-27T00:30:00+02:00", "2028-03-27T01:30:00+02:00"
    )
    day_before = create_published(
        world, "DST day before", "2028-03-25T22:00:00+01:00", "2028-03-25T23:00:00+01:00"
    )

    body = client.get(
        "/items",
        params={
            "category": world["category"],
            "q": "DST",
            "window_start": "2028-03-26T00:00:00+01:00",
            "window_end": "2028-03-26T23:59:59.999+02:00",
        },
        headers=world["student"],
    ).json()
    ids = [entry["id"] for entry in body["data"]]

    assert ids == [early, late]
    assert next_day not in ids and day_before not in ids


def create_published_event(world, title: str, starts_at: str, ends_at: str) -> str:
    client = world["client"]
    body = {
        "title": title,
        "description": "Integration event",
        "location": "Grand salon",
        "starts_at": starts_at,
        "ends_at": ends_at,
        "time_zone": "Europe/Paris",
        "category": world["category"],
    }
    created = client.post("/events", json=body, headers=world["organizer"])
    assert created.status_code == 201, created.text
    item_id = created.json()["data"]["id"]
    published = client.post(f"/items/{item_id}/publish", headers=world["organizer"])
    assert published.status_code == 200, published.text
    return item_id


def _user_id_from_auth(services, headers: dict) -> int:
    token = headers["Authorization"].removeprefix("Bearer ")
    return services.auth_service.decode_access_token(token).user_id


def _count(services, sql: str, **params) -> int:
    with services.participation_service.engine.connect() as connection:
        return connection.execute(text(sql), params).scalar_one()


def _set_participation_status(services, user_id: int, item_id: int, status_value: str) -> None:
    with services.participation_service.engine.begin() as connection:
        updated = connection.execute(
            text(
                """
                UPDATE participations
                SET status = :status
                WHERE user_id = :user_id AND item_id = :item_id
                """
            ),
            {"status": status_value, "user_id": user_id, "item_id": int(item_id)},
        ).rowcount
        assert updated == 1


def test_leave_item_removes_membership_but_keeps_nonempty_group(world):
    client = world["client"]
    services = world["services"]
    item_id = create_published(
        world,
        "Leave nonempty group",
        "2028-07-01T10:00:00+02:00",
        "2028-07-01T12:00:00+02:00",
    )
    assert client.post(f"/items/{item_id}/join", headers=world["student"]).status_code == 201
    assert client.post(f"/items/{item_id}/join", headers=world["student_b"]).status_code == 201
    assert client.put(f"/items/{item_id}/saved", headers=world["student"]).status_code == 204

    created = client.post(
        f"/items/{item_id}/groups",
        json={"name": f"pair-{world['run']}"},
        headers=world["student"],
    )
    assert created.status_code == 201, created.text
    group_id = created.json()["data"]["id"]
    assert (
        client.post(f"/groups/{group_id}/members", headers=world["student_b"]).status_code
        == 204
    )

    left = client.delete(f"/items/{item_id}/join", headers=world["student"])
    assert left.status_code == 204, left.text

    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE user_id = :user_id AND item_id = :item_id",
            user_id=_user_id_from_auth(services, world["student"]),
            item_id=int(item_id),
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE user_id = :user_id AND item_id = :item_id",
            user_id=_user_id_from_auth(services, world["student"]),
            item_id=int(item_id),
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM quest_groups WHERE group_id = :group_id",
            group_id=int(group_id),
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE group_id = :group_id AND user_id = :user_id",
            group_id=int(group_id),
            user_id=_user_id_from_auth(services, world["student_b"]),
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM saved_events WHERE user_id = :user_id AND item_id = :item_id",
            user_id=_user_id_from_auth(services, world["student"]),
            item_id=int(item_id),
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE user_id = :user_id AND item_id = :item_id",
            user_id=_user_id_from_auth(services, world["student_b"]),
            item_id=int(item_id),
        )
        == 1
    )


def test_leave_item_closes_group_when_last_member(world):
    client = world["client"]
    services = world["services"]
    item_id = create_published(
        world,
        "Leave last member",
        "2028-07-02T10:00:00+02:00",
        "2028-07-02T12:00:00+02:00",
    )
    assert client.post(f"/items/{item_id}/join", headers=world["student"]).status_code == 201
    created = client.post(
        f"/items/{item_id}/groups",
        json={"name": f"solo-{world['run']}"},
        headers=world["student"],
    )
    assert created.status_code == 201, created.text
    group_id = int(created.json()["data"]["id"])

    assert client.delete(f"/items/{item_id}/join", headers=world["student"]).status_code == 204
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM quest_groups WHERE group_id = :group_id",
            group_id=group_id,
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE group_id = :group_id",
            group_id=group_id,
        )
        == 0
    )


def test_leave_item_without_group_and_leave_event(world):
    client = world["client"]
    services = world["services"]
    quest_id = create_published(
        world,
        "Leave without group",
        "2028-07-03T10:00:00+02:00",
        "2028-07-03T12:00:00+02:00",
    )
    event_id = create_published_event(
        world,
        "Leave event RSVP",
        "2028-07-03T18:00:00+02:00",
        "2028-07-03T20:00:00+02:00",
    )
    student_id = _user_id_from_auth(services, world["student"])

    assert client.post(f"/items/{quest_id}/join", headers=world["student"]).status_code == 201
    assert client.post(f"/items/{event_id}/join", headers=world["student"]).status_code == 201

    assert client.delete(f"/items/{quest_id}/join", headers=world["student"]).status_code == 204
    assert client.delete(f"/items/{event_id}/join", headers=world["student"]).status_code == 204

    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE user_id = :user_id AND item_id = :item_id",
            user_id=student_id,
            item_id=int(quest_id),
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE user_id = :user_id AND item_id = :item_id",
            user_id=student_id,
            item_id=int(event_id),
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE user_id = :user_id AND item_id = :item_id",
            user_id=student_id,
            item_id=int(quest_id),
        )
        == 0
    )


def test_refused_leave_preserves_participation_membership_and_saved(world):
    client = world["client"]
    services = world["services"]
    item_id = create_published(
        world,
        "Refused leave",
        "2028-07-04T10:00:00+02:00",
        "2028-07-04T12:00:00+02:00",
    )
    student_id = _user_id_from_auth(services, world["student"])
    assert client.post(f"/items/{item_id}/join", headers=world["student"]).status_code == 201
    assert client.put(f"/items/{item_id}/saved", headers=world["student"]).status_code == 204
    created = client.post(
        f"/items/{item_id}/groups",
        json={"name": f"locked-{world['run']}"},
        headers=world["student"],
    )
    assert created.status_code == 201, created.text
    group_id = int(created.json()["data"]["id"])
    _set_participation_status(services, student_id, item_id, "pending")

    refused = client.delete(f"/items/{item_id}/join", headers=world["student"])
    assert refused.status_code == 409, refused.text
    assert refused.json()["errors"][0]["code"] == "proof_already_submitted"

    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE user_id = :user_id AND item_id = :item_id AND status = 'pending'",
            user_id=student_id,
            item_id=int(item_id),
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE group_id = :group_id AND user_id = :user_id",
            group_id=group_id,
            user_id=student_id,
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM quest_groups WHERE group_id = :group_id",
            group_id=group_id,
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM saved_events WHERE user_id = :user_id AND item_id = :item_id",
            user_id=student_id,
            item_id=int(item_id),
        )
        == 1
    )


def test_leave_item_rolls_back_membership_when_participation_delete_fails(world, monkeypatch):
    client = world["client"]
    services = world["services"]
    item_id = create_published(
        world,
        "Leave rollback",
        "2028-07-05T10:00:00+02:00",
        "2028-07-05T12:00:00+02:00",
    )
    student_id = _user_id_from_auth(services, world["student"])
    assert client.post(f"/items/{item_id}/join", headers=world["student"]).status_code == 201
    created = client.post(
        f"/items/{item_id}/groups",
        json={"name": f"rollback-{world['run']}"},
        headers=world["student"],
    )
    assert created.status_code == 201, created.text
    group_id = int(created.json()["data"]["id"])

    service = services.participation_service
    original_begin = service.engine.begin

    class FailingConnection:
        def __init__(self, connection):
            self._connection = connection

        def execute(self, statement, *args, **kwargs):
            sql = str(statement)
            if "DELETE FROM participations" in sql:
                raise RuntimeError("forced participation delete failure")
            return self._connection.execute(statement, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._connection, name)

    class FailingBegin:
        def __enter__(self):
            self._cm = original_begin()
            self._connection = FailingConnection(self._cm.__enter__())
            return self._connection

        def __exit__(self, exc_type, exc, tb):
            return self._cm.__exit__(exc_type, exc, tb)

    monkeypatch.setattr(service.engine, "begin", lambda: FailingBegin())

    with pytest.raises(RuntimeError, match="forced participation delete failure"):
        service.leave_item(student_id, int(item_id))

    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE user_id = :user_id AND item_id = :item_id",
            user_id=student_id,
            item_id=int(item_id),
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE group_id = :group_id AND user_id = :user_id",
            group_id=group_id,
            user_id=student_id,
        )
        == 1
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM quest_groups WHERE group_id = :group_id",
            group_id=group_id,
        )
        == 1
    )


def test_concurrent_leave_item_membership_changes(world):
    """Two members leaving the same group via leave_item must not leave orphans."""
    import threading

    client = world["client"]
    services = world["services"]
    item_id = create_published(
        world,
        "Concurrent leave",
        "2028-07-06T10:00:00+02:00",
        "2028-07-06T12:00:00+02:00",
    )
    assert client.post(f"/items/{item_id}/join", headers=world["student"]).status_code == 201
    assert client.post(f"/items/{item_id}/join", headers=world["student_b"]).status_code == 201
    created = client.post(
        f"/items/{item_id}/groups",
        json={"name": f"race-{world['run']}"},
        headers=world["student"],
    )
    assert created.status_code == 201, created.text
    group_id = int(created.json()["data"]["id"])
    assert (
        client.post(f"/groups/{group_id}/members", headers=world["student_b"]).status_code
        == 204
    )

    barrier = threading.Barrier(2)
    results: list[int] = []
    errors: list[BaseException] = []

    def leave(headers: dict) -> None:
        try:
            barrier.wait(timeout=5)
            response = client.delete(f"/items/{item_id}/join", headers=headers)
            results.append(response.status_code)
        except BaseException as error:  # noqa: BLE001 - collect for the main thread
            errors.append(error)

    threads = [
        threading.Thread(target=leave, args=(world["student"],)),
        threading.Thread(target=leave, args=(world["student_b"],)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == []
    assert results == [204, 204]
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM group_members WHERE group_id = :group_id",
            group_id=group_id,
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM quest_groups WHERE group_id = :group_id",
            group_id=group_id,
        )
        == 0
    )
    assert (
        _count(
            services,
            "SELECT COUNT(*) FROM participations WHERE item_id = :item_id",
            item_id=int(item_id),
        )
        == 0
    )
