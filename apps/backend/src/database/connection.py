from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy import Engine
from sqlalchemy.engine import Connection
from sqlalchemy.engine.url import URL
from utilities.settings import DatabaseSettings


def build_database_url(settings: DatabaseSettings) -> URL:
    return URL.create(
        drivername="mysql+pymysql",
        username=settings.user,
        password=settings.password,
        host=settings.host,
        port=settings.port,
        database=settings.database,
        # utf8mb4 carries accented European characters end to end.
        query={"charset": "utf8mb4"},
    )


def create_database_engine(settings: DatabaseSettings) -> Engine:
    return create_engine(build_database_url(settings), pool_pre_ping=True)


@contextmanager
def open_connection(settings: DatabaseSettings) -> Iterator[Connection]:
    engine = create_database_engine(settings)
    try:
        with engine.connect() as connection:
            yield connection
    finally:
        engine.dispose()
