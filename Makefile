.PHONY: all clean lint db-schema

python-version = 3.12

# Inside the devcontainer, docker-compose already injects the database settings.
# On the host (e.g. running `make` from macOS), load them from the devcontainer
# .env and reach MySQL through the port docker-compose publishes on localhost,
# since the container hostname only resolves inside the Docker network.
ENV_FILE := .devcontainer/.env
ifndef MYSQL_USER
ifneq ($(wildcard $(ENV_FILE)),)
include $(ENV_FILE)
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' $(ENV_FILE))
MYSQL_HOST := 127.0.0.1
export MYSQL_HOST
endif
endif

all:
	@echo "Using Python version $(python-version)"

clean:
	@echo "Cleaning up..."

lint:
	cd apps/backend && poetry run pre-commit run --all-files

db-schema:
	cd apps/backend/src && poetry run python -m database.apply_schema
