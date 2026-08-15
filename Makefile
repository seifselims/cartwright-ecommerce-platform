COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml
# --wait treats an exited container as a failure, so the one-shot minio-init
# is started but not waited on.
LONG_RUNNING := postgres redis redis-queue meilisearch minio mailpit

.PHONY: up down logs ps restart nuke test check

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
