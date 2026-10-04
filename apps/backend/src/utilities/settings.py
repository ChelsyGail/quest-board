import os
from dataclasses import dataclass


@dataclass(frozen=True)
class DatabaseSettings:
    host: str
    port: int
    user: str
    password: str
    database: str


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
