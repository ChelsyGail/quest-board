"""Bounded retries for transactions InnoDB picks as a deadlock victim.

The approval and claim transactions lock several rows (BE-46, BE-59). Locks are
always taken in the same order, so deadlocks should be rare, but InnoDB can
still choose a victim under load. The victim's whole transaction was rolled
back, so it is safe to run it again from the start, a few times at most.

Those same transactions run at READ COMMITTED (BE-51). Under MySQL's default
REPEATABLE READ, a transaction's plain SELECTs keep reading the snapshot taken
by its first plain SELECT. A review that waited on another moderator's lock
would then miss the review that moderator just committed. At READ COMMITTED
every statement sees the latest committed rows, so whoever waits rechecks the
real state once it holds the lock.
"""
from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TypeVar

from sqlalchemy import Engine
from sqlalchemy.engine import Connection
from sqlalchemy.exc import OperationalError

logger = logging.getLogger(__name__)

ResultT = TypeVar("ResultT")

MYSQL_DEADLOCK = 1213
MYSQL_LOCK_WAIT_TIMEOUT = 1205
RETRYABLE_ERRORS = frozenset({MYSQL_DEADLOCK, MYSQL_LOCK_WAIT_TIMEOUT})
DEFAULT_ATTEMPTS = 3
READ_COMMITTED = "READ COMMITTED"


@contextmanager
def begin_read_committed(engine: Engine) -> Iterator[Connection]:
    """A READ COMMITTED transaction that commits when the block ends and rolls
    back if it raises. The pool restores the default level when the
    connection is returned."""
    with engine.connect() as connection:
        connection = connection.execution_options(isolation_level=READ_COMMITTED)
        with connection.begin():
            yield connection


def mysql_error_code(error: OperationalError) -> int | None:
    original = getattr(error, "orig", None)
    args = getattr(original, "args", ())
    return args[0] if args and isinstance(args[0], int) else None


def with_deadlock_retry(
    operation: Callable[[], ResultT], attempts: int = DEFAULT_ATTEMPTS
) -> ResultT:
    """Runs `operation` (which must open and commit its own transaction),
    retrying it when MySQL reports a deadlock or a lock wait timeout."""
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except OperationalError as error:
            code = mysql_error_code(error)
            if code not in RETRYABLE_ERRORS or attempt == attempts:
                raise
            delay = 0.05 * (2 ** (attempt - 1)) * (1 + random.random())
            logger.warning(
                "Transaction retried after a lock conflict",
                extra={"mysql_error": code, "attempt": attempt},
            )
            time.sleep(delay)
    raise AssertionError("unreachable")
