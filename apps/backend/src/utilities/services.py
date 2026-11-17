from dataclasses import dataclass

from services.auth_service import AuthService
from services.catalogue_service import CatalogueService
from services.health_service import HealthService
from services.moderation_audit_service import ModerationAuditService
from services.participation_service import ParticipationService
from services.proof_service import ProofService
from services.recognition_service import RecognitionService
from services.review_service import ReviewService
from services.role_request_service import RoleRequestService
from services.user_service import UserService
from utilities.object_store import LocalObjectStore
from utilities.settings import load_auth_settings
from utilities.settings import load_database_settings
from utilities.settings import load_media_settings


@dataclass
class Services:
    health_service: HealthService
    user_service: UserService
    auth_service: AuthService
    role_request_service: RoleRequestService
    catalogue_service: CatalogueService
    participation_service: ParticipationService
    proof_service: ProofService
    review_service: ReviewService
    recognition_service: RecognitionService
    moderation_audit_service: ModerationAuditService


def setup_services() -> Services:
    health_service = HealthService()
    user_service = UserService(load_database_settings())
    auth_service = AuthService(load_auth_settings(), user_service)
    role_request_service = RoleRequestService(load_database_settings())
    catalogue_service = CatalogueService(load_database_settings())
    participation_service = ParticipationService(load_database_settings())
    proof_service = ProofService(
        load_database_settings(), LocalObjectStore(load_media_settings().root)
    )
    review_service = ReviewService(load_database_settings())
    recognition_service = RecognitionService(load_database_settings())
    moderation_audit_service = ModerationAuditService(load_database_settings())

    return Services(
        health_service=health_service,
        user_service=user_service,
        auth_service=auth_service,
        role_request_service=role_request_service,
        catalogue_service=catalogue_service,
        participation_service=participation_service,
        proof_service=proof_service,
        review_service=review_service,
        recognition_service=recognition_service,
        moderation_audit_service=moderation_audit_service,
    )
