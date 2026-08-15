COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml
# --wait treats an exited container as a failure, so the one-shot minio-init
# is started but not waited on.
LONG_RUNNING := postgres redis redis-queue meilisearch minio mailpit

.PHONY: up down logs ps restart nuke seed test check

## Start the backing services and wait until they are healthy.
up:
	$(COMPOSE) up -d
	$(COMPOSE) up -d --wait $(LONG_RUNNING)

## Stop everything, keeping volumes (and therefore the database).
down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

restart:
	$(COMPOSE) restart

## Destroy the stack including every volume. This deletes the database.
nuke:
	$(COMPOSE) down -v

## Rebuild the demo dataset: 8 vendors, 500 products, 1,500 variants, 50k
## orders (§15, phase 1). Truncates first, so it is a rebuild and not a top-up.
## Deterministic — pass SEED=n for a different but equally reproducible dataset.
seed:
	npm run db:seed

## Unit tests (§11.1). Integration tests bring their own Postgres and Redis via
## Testcontainers and join here once Phase 1 adds them.
test:
	npm test

## Everything CI gates on, in CI's order — run before pushing.
check:
	npm run typecheck
	npm run lint
	npm run format:check
	npm test
	npm run build
