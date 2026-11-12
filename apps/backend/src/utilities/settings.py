import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DatabaseSettings:
    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass(frozen=True)
class MediaSettings:
    # Where the local object store keeps proof files (BE-37). Outside src/ and
    # covered by the repo's `var/` ignore rule, so proof never gets committed.
    root: Path


@dataclass(frozen=True)
class AuthSettings:
    secret_key: str
    algorithm: str
    access_token_expires_minutes: int


def load_database_settings() -> DatabaseSettings:
    return DatabaseSettings(
        host=os.environ.get("MYSQL_HOST", "mysql-db-service"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ["MYSQL_USER"],
        password=os.environ["MYSQL_PASSWORD"],
        database=os.environ["MYSQL_DATABASE"],
    )


def load_auth_settings() -> AuthSettings:
    return AuthSettings(
        secret_key=os.environ["JWT_SECRET_KEY"],
        algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
        access_token_expires_minutes=int(os.environ.get("JWT_EXPIRES_MINUTES", "60")),
    )


def load_media_settings() -> MediaSettings:
    default_root = Path(__file__).resolve().parents[2] / "var" / "proof-media"
    return MediaSettings(root=Path(os.environ.get("PROOF_MEDIA_DIR", default_root)))
