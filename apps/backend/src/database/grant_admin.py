"""Gives the admin role to an existing user. Run once to create the first admin.

Usage (from apps/backend/src): python -m database.grant_admin someone@example.com
"""
import logging
import sys

from database.connection import open_connection
from sqlalchemy import text
from utilities.settings import load_database_settings

logger = logging.getLogger(__name__)


def grant_admin(email: str) -> bool:
    settings = load_database_settings()
    with open_connection(settings) as connection:
        result = connection.execute(
            text(
                """
                UPDATE users
                SET roles = CONCAT_WS(',', roles, 'admin'),
                    updated_at = CURRENT_TIMESTAMP(6)
                WHERE email = :email AND deleted_at IS NULL
                """
            ),
            {"email": email},
        )
        connection.commit()
    return result.rowcount > 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m database.grant_admin <email>")
    if grant_admin(sys.argv[1]):
        logger.info("Granted admin to %s", sys.argv[1])
    else:
        sys.exit(f"No active user with email {sys.argv[1]}")
