"""Deletes proof uploads that were never attached to a submission (BE-43).

Run from apps/backend/src:   python -m jobs.cleanup_uploads
or from the repo root:       make cleanup-uploads

Safe to run as often as you like; schedule it (cron, or the worker once it
exists) every hour or so. The age threshold is UPLOAD_ABANDON_AFTER_HOURS
(default 24).
"""
import logging

from services.proof_service import ProofService
from utilities.object_store import LocalObjectStore
from utilities.settings import load_database_settings
from utilities.settings import load_media_settings

logger = logging.getLogger(__name__)


def main() -> int:
    media_settings = load_media_settings()
    service = ProofService(
        load_database_settings(), LocalObjectStore(media_settings.root)
    )
    deleted = service.delete_abandoned_uploads(media_settings.abandon_after)
    logger.info("Deleted %d abandoned upload(s)", deleted)
    return deleted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
