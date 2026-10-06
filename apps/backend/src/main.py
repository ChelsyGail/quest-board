import logging

from api.app_factory import setup_app
from utilities.services import setup_services

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

services = setup_services()
app = setup_app(services)
