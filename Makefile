.PHONY: all lint db-schema cleanup-uploads

python-version = 3.12

all:
	@echo "Using Python version $(python-version)"

clean:
	@echo "Cleaning up..."

lint:
	cd apps/backend && poetry run pre-commit run --all-files

db-schema:
	cd apps/backend/src && poetry run python -m database.apply_schema

# Deletes proof uploads never attached to a submission (BE-43).
# Honours PROOF_MEDIA_DIR and UPLOAD_ABANDON_AFTER_HOURS from the environment.
cleanup-uploads:
	cd apps/backend/src && poetry run python -m jobs.cleanup_uploads
