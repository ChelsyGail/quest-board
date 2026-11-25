"""Opt-in seed for the dedicated QuestBoard presentation database only.

Hard guards:
  - MYSQL_DATABASE must equal ``questboard_presentation``
  - CLI must pass ``--i-understand-this-targets-presentation-only``

Uses the live HTTP API (supported product paths) against a running backend that
is already pointed at the presentation database. Never resets or touches other
databases.

Example (after API is running on the presentation DB)::

  export MYSQL_DATABASE=questboard_presentation
  export PRESENTATION_API_BASE=http://127.0.0.1:8000
  export PRESENTATION_PASSWORD='…'   # min 12 chars; not committed
  python -m jobs.seed_presentation --i-understand-this-targets-presentation-only

Clean restore (presentation DB only — never other databases)::

  python -m jobs.seed_presentation --i-understand-this-targets-presentation-only \\
    --wipe-presentation-data-first
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

PRESENTATION_DATABASE = "questboard_presentation"
REQUIRED_FLAG = "--i-understand-this-targets-presentation-only"

# Tiny 1×1 PNG — harmless sample proof media (not a real photograph of people).
SAMPLE_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


class ApiClient:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def request(self, method: str, path: str, token: str | None = None, body=None, raw: bytes | None = None, content_type: str | None = None):
        headers = {}
        data = None
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if raw is not None:
            data = raw
            headers["Content-Type"] = content_type or "application/octet-stream"
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                raw_body = resp.read()
                if not raw_body:
                    return resp.status, None
                return resp.status, json.loads(raw_body.decode("utf-8"))
        except urllib.error.HTTPError as err:
            raw_body = err.read()
            try:
                payload = json.loads(raw_body.decode("utf-8")) if raw_body else None
            except json.JSONDecodeError:
                payload = {"raw": raw_body.decode("utf-8", errors="replace")}
            return err.code, payload


def fail(message: str, code: int = 2) -> None:
    print(f"seed_presentation: {message}", file=sys.stderr)
    raise SystemExit(code)


def require_presentation_database() -> None:
    database = os.environ.get("MYSQL_DATABASE", "")
    if database != PRESENTATION_DATABASE:
        fail(
            f"Refusing to run: MYSQL_DATABASE={database!r}. "
            f"This job only runs when MYSQL_DATABASE={PRESENTATION_DATABASE!r}."
        )


def login(client: ApiClient, email: str, password: str) -> str:
    status, doc = client.request("POST", "/auth/login", body={"email": email, "password": password})
    if status != 200:
        fail(f"login failed for {email}: {status} {doc}")
    return doc["data"]["attributes"]["access_token"]


def register(client: ApiClient, name: str, email: str, password: str) -> None:
    status, doc = client.request(
        "POST",
        "/users",
        body={"name": name, "email": email, "password": password},
    )
    if status in (200, 201):
        print(f"registered {email}")
        return
    # Idempotent re-seed: duplicate email is fine.
    code = None
    if isinstance(doc, dict) and doc.get("errors"):
        code = doc["errors"][0].get("code")
    if status == 409 or code in {"duplicate_email", "email_taken", "already_exists"}:
        print(f"already registered {email}")
        return
    fail(f"register failed for {email}: {status} {doc}")


def elevate_roles(emails_to_roles: dict[str, str]) -> None:
    """Role elevation for local demo accounts via SQL (presentation DB only)."""
    require_presentation_database()
    from database.connection import open_connection
    from sqlalchemy import text
    from utilities.settings import load_database_settings

    settings = load_database_settings()
    if settings.database != PRESENTATION_DATABASE:
        fail("database settings escaped the presentation guard")
    with open_connection(settings) as connection:
        for email, roles in emails_to_roles.items():
            connection.execute(
                text("UPDATE users SET roles = :roles WHERE email = :email"),
                {"roles": roles, "email": email},
            )
        connection.commit()
    print("elevated demo account roles")


def wipe_presentation_data() -> None:
    """Delete presentation-demo rows only. Preserves schema_migrations and badge catalogue."""
    require_presentation_database()
    from database.connection import open_connection
    from sqlalchemy import text
    from utilities.settings import load_database_settings

    settings = load_database_settings()
    if settings.database != PRESENTATION_DATABASE:
        fail("database settings escaped the presentation guard")

    preserve = {"schema_migrations", "badges"}
    with open_connection(settings) as connection:
        if connection.execute(text("SELECT DATABASE()")).scalar() != PRESENTATION_DATABASE:
            fail("connection is not on the presentation database")
        rows = connection.execute(text("SHOW TABLES")).fetchall()
        tables = []
        for row in rows:
            name = row[0]
            if name in preserve:
                continue
            if not name.replace("_", "").isalnum():
                fail(f"refusing unexpected table name {name!r}")
            tables.append(name)
        connection.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in tables:
            connection.execute(text(f"TRUNCATE TABLE `{table}`"))
        connection.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        connection.commit()
    print(f"wiped {len(tables)} tables in {PRESENTATION_DATABASE} (kept {sorted(preserve)})")

    media_dir = Path(
        os.environ.get(
            "PROOF_MEDIA_DIR",
            str(Path(__file__).resolve().parents[2] / "var" / "proof-media-presentation"),
        )
    )
    if media_dir.exists():
        removed = 0
        for path in media_dir.rglob("*"):
            if path.is_file():
                path.unlink()
                removed += 1
        print(f"cleared {removed} files under {media_dir}")



def seed(api_base: str, password: str) -> None:
    require_presentation_database()
    client = ApiClient(api_base)

    accounts = {
        "student": ("Maya Chen", "maya.chen@aup.edu"),
        "organiser": ("Jules Moreau", "jules.moreau@aup.edu"),
        "moderator": ("Samira Haddad", "samira.haddad@aup.edu"),
        "admin": ("Alex Rivera", "alex.rivera@aup.edu"),
    }
    for _, (name, email) in accounts.items():
        register(client, name, email, password)

    elevate_roles(
        {
            accounts["organiser"][1]: "student,organizer",
            accounts["moderator"][1]: "student,moderator",
            accounts["admin"][1]: "student,admin",
            accounts["student"][1]: "student",
        }
    )

    org = login(client, accounts["organiser"][1], password)
    stu = login(client, accounts["student"][1], password)
    mod = login(client, accounts["moderator"][1], password)

    def create_quest(fields: dict, publish: bool = True) -> str:
        status, doc = client.request("POST", "/quests", token=org, body=fields)
        if status != 201:
            fail(f"create quest failed: {status} {doc}")
        item_id = str(doc["data"]["id"])
        if publish:
            p_status, p_doc = client.request("POST", f"/items/{item_id}/publish", token=org)
            if p_status != 200:
                fail(f"publish quest {item_id} failed: {p_status} {p_doc}")
        print(f"quest {item_id}: {fields['title']} ({'published' if publish else 'draft'})")
        return item_id

    def create_event(fields: dict) -> str:
        status, doc = client.request("POST", "/events", token=org, body=fields)
        if status != 201:
            fail(f"create event failed: {status} {doc}")
        item_id = str(doc["data"]["id"])
        p_status, p_doc = client.request("POST", f"/items/{item_id}/publish", token=org)
        if p_status != 200:
            fail(f"publish event {item_id} failed: {p_status} {p_doc}")
        print(f"event {item_id}: {fields['title']}")
        return item_id

    # Shared campus window — upcoming, readable dates.
    quests = [
        {
            "title": "Library Quiet Hours Patrol",
            "description": "Help keep the Quai d'Orsay reading rooms calm during midterms. Walk the floors once and leave a short note about what you checked.",
            "location": "Quai d'Orsay Library",
            "starts_at": "2026-11-24T14:00:00+01:00",
            "ends_at": "2026-11-24T17:00:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Volunteering",
            "proof_instructions": "Write two sentences about the floors you visited and attach one photo of the quiet-hours sign.",
            "point_value": 20,
            "requires_text_proof": True,
            "requires_media_proof": True,
        },
        {
            "title": "Seine Cleanup Walk",
            "description": "Join a short riverside cleanup between Pont de l'Alma and the AUP campus. Gloves are provided at the meeting point.",
            "location": "Pont de l'Alma",
            "starts_at": "2026-11-22T10:00:00+01:00",
            "ends_at": "2026-11-22T12:00:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Volunteering",
            "proof_instructions": "Upload a photo of your filled bag or the collection point, plus a short caption.",
            "point_value": 25,
            "requires_text_proof": True,
            "requires_media_proof": True,
        },
        {
            "title": "Campus Photo Walk",
            "description": "Capture three everyday campus details — architecture, greenery, or student life — and share a favourite shot with a caption.",
            "location": "Combes Student Center",
            "starts_at": "2026-11-25T15:30:00+01:00",
            "ends_at": "2026-11-25T17:00:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Arts",
            "proof_instructions": "Attach one photo and a short caption explaining why you chose it.",
            "point_value": 15,
            "requires_text_proof": True,
            "requires_media_proof": True,
        },
        {
            "title": "Welcome Desk Shift",
            "description": "Staff the welcome desk for an hour and help visitors find classrooms and offices.",
            "location": "Grenelle Building Lobby",
            "starts_at": "2026-11-21T09:00:00+01:00",
            "ends_at": "2026-11-21T18:00:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Campus",
            "proof_instructions": "Leave a short note confirming your shift time. A photo is optional.",
            "point_value": 10,
            "requires_text_proof": True,
            "requires_media_proof": False,
        },
        {
            # Fresh quest for live demo — published, unused by the student.
            "title": "Greenhouse Plant Care",
            "description": "Water the greenhouse trays and note which plants need attention. Perfect for a short campus break.",
            "location": "AUP Greenhouse",
            "starts_at": "2026-11-26T11:00:00+01:00",
            "ends_at": "2026-11-26T16:00:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Campus",
            "proof_instructions": "Describe what you watered and attach one clear photo of a tray or plant label.",
            "point_value": 15,
            "requires_text_proof": True,
            "requires_media_proof": True,
        },
    ]

    quest_ids = [create_quest(q) for q in quests]
    library_id, seine_id, photo_id, welcome_id, greenhouse_id = quest_ids

    create_event(
        {
            "title": "Open Mic at Combes",
            "description": "An informal evening of music, poetry and short readings. Bring something to share or just listen.",
            "location": "Combes Student Center",
            "starts_at": "2026-11-27T19:00:00+01:00",
            "ends_at": "2026-11-27T21:30:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Social",
        }
    )
    create_event(
        {
            "title": "Career Coffee Morning",
            "description": "Meet alumni and career advisors over coffee. Drop in for any part of the morning.",
            "location": "Amphithéâtre 1",
            "starts_at": "2026-11-28T09:30:00+01:00",
            "ends_at": "2026-11-28T11:30:00+01:00",
            "time_zone": "Europe/Paris",
            "category": "Career",
        }
    )

    # Rewards
    rewards = [
        {
            "name": "Campus Café Voucher",
            "description": "A complimentary drink at the campus café.",
            "point_cost": 15,
            "eligibility": {"type": "approved_quests", "threshold": 1},
        },
        {
            "name": "QuestBoard Sticker Pack",
            "description": "A small pack of campus stickers for your laptop.",
            "point_cost": 10,
            "eligibility": {"type": "none"},
        },
        {
            "name": "Library Late Pass",
            "description": "One extended library evening during exam week.",
            "point_cost": 25,
            "eligibility": {"type": "total_points", "threshold": 30},
        },
    ]
    reward_ids = []
    for reward in rewards:
        status, doc = client.request("POST", "/rewards", token=org, body=reward)
        if status != 201:
            fail(f"create reward failed: {status} {doc}")
        reward_ids.append(str(doc["data"]["id"]))
        print(f"reward {doc['data']['id']}: {reward['name']}")

    # Completed journey on Library Quiet Hours (reject → resubmit → approve → claim)
    status, doc = client.request("POST", f"/items/{library_id}/join", token=stu, body={})
    if status != 201:
        fail(f"join library quest failed: {status} {doc}")
    part_id = str(doc["data"]["id"])

    up_status, up_doc = client.request(
        "POST",
        "/uploads",
        token=stu,
        raw=SAMPLE_PNG,
        content_type="image/png",
    )
    if up_status not in (200, 201):
        fail(f"upload failed: {up_status} {up_doc}")
    media_id = int(up_doc["data"]["id"])

    status, doc = client.request(
        "POST",
        f"/participations/{part_id}/submissions",
        token=stu,
        body={
            "text": "I checked the second and third floors. Everything looked quiet.",
            "media_ids": [media_id],
        },
    )
    if status != 201:
        fail(f"first submit failed: {status} {doc}")
    submission_id = str(doc["data"]["id"])

    status, doc = client.request(
        "POST",
        f"/moderation/submissions/{submission_id}/reject",
        token=mod,
        body={"feedback": "Please include the quiet-hours sign in the photo and mention the time you visited."},
    )
    if status != 201:
        fail(f"reject failed: {status} {doc}")

    up_status, up_doc = client.request(
        "POST",
        "/uploads",
        token=stu,
        raw=SAMPLE_PNG,
        content_type="image/png",
    )
    media_id2 = int(up_doc["data"]["id"])
    status, doc = client.request(
        "POST",
        f"/participations/{part_id}/submissions",
        token=stu,
        body={
            "text": "Visited at 15:10. Quiet-hours signs were posted on floors two and three; both areas were calm.",
            "media_ids": [media_id2],
        },
    )
    if status != 201:
        fail(f"resubmit failed: {status} {doc}")
    submission_id2 = str(doc["data"]["id"])

    status, doc = client.request(
        "POST",
        f"/moderation/submissions/{submission_id2}/approve",
        token=mod,
        body={},
    )
    if status != 201:
        fail(f"approve failed: {status} {doc}")
    print("library quest: rejected → resubmitted → approved")

    # Second approved quest for richer points (Seine) — direct approve
    status, doc = client.request("POST", f"/items/{seine_id}/join", token=stu, body={})
    part2 = str(doc["data"]["id"])
    up_status, up_doc = client.request(
        "POST", "/uploads", token=stu, raw=SAMPLE_PNG, content_type="image/png"
    )
    media3 = int(up_doc["data"]["id"])
    status, doc = client.request(
        "POST",
        f"/participations/{part2}/submissions",
        token=stu,
        body={
            "text": "Collected litter along the river path and dropped bags at the meeting point.",
            "media_ids": [media3],
        },
    )
    sub3 = str(doc["data"]["id"])
    status, doc = client.request(
        "POST", f"/moderation/submissions/{sub3}/approve", token=mod, body={}
    )
    if status != 201:
        fail(f"seine approve failed: {status} {doc}")

    # Claim café voucher
    cafe_id = reward_ids[0]
    status, doc = client.request("POST", f"/rewards/{cafe_id}/claims", token=stu, body={})
    if status != 201:
        fail(f"claim failed: {status} {doc}")
    print(f"claimed reward {cafe_id}")

    # RSVP to open mic for My Quests/calendar variety
    # Find open mic by listing — we know it was created; get from org items or student catalogue
    status, doc = client.request("GET", "/items?page=1&page_size=20&q=Open%20Mic", token=stu)
    if status == 200 and doc.get("data"):
        event_id = str(doc["data"][0]["id"])
        client.request("POST", f"/items/{event_id}/join", token=stu, body={})
        print(f"RSVP event {event_id}")

    # One pending submission for moderator queue screenshot (Welcome Desk — text only)
    status, doc = client.request("POST", f"/items/{welcome_id}/join", token=stu, body={})
    # Student already has many joins — create a second student? Welcome might work with same student.
    # If already at capacity of story, use photo walk instead with a second account... keep simple:
    # Use photo walk as pending for queue.
    # Actually student can have welcome pending:
    if status == 201:
        part_w = str(doc["data"]["id"])
        status, doc = client.request(
            "POST",
            f"/participations/{part_w}/submissions",
            token=stu,
            body={"text": "Covered the 10:00–11:00 welcome desk shift.", "media_ids": []},
        )
        if status == 201:
            print(f"pending proof ready for moderator review (Welcome Desk), submission {doc['data']['id']}")

    # Greenhouse left unused for live demo
    print(f"fresh live-demo quest ready (unjoined): {greenhouse_id} Greenhouse Plant Care")
    print("seed_presentation: done")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        REQUIRED_FLAG,
        action="store_true",
        required=True,
        help="Required confirmation that this targets the presentation database only.",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("PRESENTATION_API_BASE", "http://127.0.0.1:8000"),
    )
    parser.add_argument(
        "--wipe-presentation-data-first",
        action="store_true",
        help=(
            "TRUNCATE data tables in questboard_presentation only (keeps schema_migrations "
            "and badges), clear PROOF_MEDIA_DIR, then seed. Refuses any other MYSQL_DATABASE."
        ),
    )
    args = parser.parse_args(argv)

    password = os.environ.get("PRESENTATION_PASSWORD", "").strip()
    if len(password) < 12:
        fail("Set PRESENTATION_PASSWORD to a password of at least 12 characters.")

    require_presentation_database()
    if args.wipe_presentation_data_first:
        wipe_presentation_data()

    # Health check
    client = ApiClient(args.api_base)
    status, doc = client.request("GET", "/health")
    if status != 200:
        fail(f"API health check failed at {args.api_base}: {status} {doc}")

    seed(args.api_base, password)


if __name__ == "__main__":
    main()
