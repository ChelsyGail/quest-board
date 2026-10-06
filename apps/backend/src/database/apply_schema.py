"""Applies pending SQL schema files. Safe to re-run in development and deployment."""
import logging
from pathlib import Path

from database.connection import open_connection
from sqlalchemy import text
from sqlalchemy.engine import Connection
from utilities.settings import load_database_settings

SCHEMA_DIRECTORY = Path(__file__).parent / "schema"

CREATE_LEDGER_STATEMENT = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) NOT NULL,
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (filename)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
"""

logger = logging.getLogger(__name__)


def read_applied_filenames(connection: Connection) -> set[str]:
    connection.execute(text(CREATE_LEDGER_STATEMENT))
    connection.commit()
    result = connection.execute(text("SELECT filename FROM schema_migrations"))
    return {row[0] for row in result}


def split_statements(sql: str) -> list[str]:
    return [statement.strip() for statement in sql.split(";") if statement.strip()]


def apply_schema_file(connection: Connection, schema_file: Path) -> None:
    statements = split_statements(schema_file.read_text(encoding="utf-8"))
    for statement in statements:
        connection.execute(text(statement))
    connection.execute(
        text("INSERT INTO schema_migrations (filename) VALUES (:filename)"),
        {"filename": schema_file.name},
    )
    connection.commit()


def apply_schema() -> None:
    settings = load_database_settings()
    with open_connection(settings) as connection:
        applied = read_applied_filenames(connection)

        for schema_file in sorted(SCHEMA_DIRECTORY.glob("*.sql")):
            if schema_file.name in applied:
                logger.info("Skipping %s, already applied", schema_file.name)
                continue

            logger.info("Applying %s", schema_file.name)
            apply_schema_file(connection, schema_file)

    logger.info("Schema is up to date on %s", settings.database)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    apply_schema()
