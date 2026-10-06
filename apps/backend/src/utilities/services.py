from dataclasses import dataclass

from services.auth_service import AuthService
from services.health_service import HealthService
from services.role_request_service import RoleRequestService
from services.user_service import UserService
from utilities.settings import load_auth_settings
from utilities.settings import load_database_settings


@dataclass
class Services:
    health_service: HealthService
    user_service: UserService
    auth_service: AuthService
    role_request_service: RoleRequestService


def setup_services() -> Services:
    health_service = HealthService()
    user_service = UserService(load_database_settings())
    auth_service = AuthService(load_auth_settings(), user_service)
    role_request_service = RoleRequestService(load_database_settings())

    return Services(
        health_service=health_service,
        user_service=user_service,
        auth_service=auth_service,
        role_request_service=role_request_service,
    )
