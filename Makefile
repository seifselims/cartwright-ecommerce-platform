COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml
# --wait treats an exited container as a failure, so the one-shot minio-init
# is started but not waited on.
LONG_RUNNING := postgres redis redis-queue meilisearch minio mailpit

.PHONY: up down logs ps restart nuke

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
