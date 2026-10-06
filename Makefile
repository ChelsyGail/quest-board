.PHONY: all lint

python-version = 3.12

all:
	@echo "Using Python version $(python-version)"

clean:
	@echo "Cleaning up..."

lint:
	cd apps/backend && poetry run pre-commit run --all-files

db-schema:
	cd apps/backend/src && poetry run python -m database.apply_schema
