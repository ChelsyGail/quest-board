.PHONY: all lint db-schema cleanup-uploads

python-version = 3.12
# Prefer the repo's .devcontainer/.env so make targets do not silently use
# unrelated MYSQL_* defaults from the shell or Poetry's unset host.
DEVCONTAINER_ENV ?= .devcontainer/.env

define load-devcontainer-env
	@if [ ! -f "$(DEVCONTAINER_ENV)" ]; then \
		echo "Missing $(DEVCONTAINER_ENV). Copy apps/backend/.env.example values there, or export MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD (and JWT secrets) explicitly."; \
		exit 1; \
	fi
endef

all:
	@echo "Using Python version $(python-version)"

clean:
	@echo "Cleaning up..."

lint:
	cd apps/backend && poetry run pre-commit run --all-files

db-schema:
	$(load-devcontainer-env)
	cd apps/backend/src && set -a && . ../../../$(DEVCONTAINER_ENV) && set +a && \
		export MYSQL_HOST="$${MYSQL_HOST:-127.0.0.1}" && \
		poetry run python -m database.apply_schema

# Deletes proof uploads never attached to a submission (BE-43).
# Honours PROOF_MEDIA_DIR and UPLOAD_ABANDON_AFTER_HOURS from the environment.
cleanup-uploads:
	$(load-devcontainer-env)
	cd apps/backend/src && set -a && . ../../../$(DEVCONTAINER_ENV) && set +a && \
		export MYSQL_HOST="$${MYSQL_HOST:-127.0.0.1}" && \
		poetry run python -m jobs.cleanup_uploads
