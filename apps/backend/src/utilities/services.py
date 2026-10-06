from dataclasses import dataclass

from services.auth_service import AuthService
from services.health_service import HealthService
from services.user_service import UserService
from utilities.settings import load_auth_settings
from utilities.settings import load_database_settings


@dataclass
class Services:
    health_service: HealthService
    user_service: UserService
    auth_service: AuthService


def setup_services() -> Services:
    health_service = HealthService()
    user_service = UserService(load_database_settings())
    auth_service = AuthService(load_auth_settings(), user_service)
    return Services(
        health_service=health_service,
        user_service=user_service,
        auth_service=auth_service,
    )
