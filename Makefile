# ──────────────────────────────────────────────────────────────────────────────
# Leadman FWH System — Makefile
#
# Dev:  make dev       → hot-reload backend + React dev server (port 3000)
# Prod: make prod      → nginx + 4-worker uvicorn (port 80/443)
# ──────────────────────────────────────────────────────────────────────────────

.PHONY: dev dev-d prod deploy logs logs-dev down down-dev build ps clean help

COMPOSE_DEV  = docker compose -f docker-compose.dev.yml
COMPOSE_PROD = docker compose

# ── Development ───────────────────────────────────────────────────────────────

dev:           ## Start dev environment (foreground, Ctrl+C to stop)
	$(COMPOSE_DEV) up

dev-d:         ## Start dev environment (background)
	$(COMPOSE_DEV) up -d

dev-build:     ## Rebuild dev images then start
	$(COMPOSE_DEV) up --build

logs-dev:      ## Tail dev logs
	$(COMPOSE_DEV) logs -f

down-dev:      ## Stop dev environment
	$(COMPOSE_DEV) down

# ── Production ────────────────────────────────────────────────────────────────

prod:          ## Start production environment (background)
	$(COMPOSE_PROD) up -d

prod-build:    ## Rebuild prod images then start
	$(COMPOSE_PROD) up -d --build

logs:          ## Tail production logs
	$(COMPOSE_PROD) logs -f

down:          ## Stop production environment
	$(COMPOSE_PROD) down

ps:            ## Show running containers
	$(COMPOSE_PROD) ps

# ── Deploy (run on server) ───────────────────────────────────────────────────

deploy:        ## Pull latest code + rebuild + restart production
	git pull origin main
	$(COMPOSE_PROD) build --no-cache
	$(COMPOSE_PROD) up -d --remove-orphans
	docker image prune -f
	@echo "✅ Deployed at $$(date)"

# ── Maintenance ───────────────────────────────────────────────────────────────

build:         ## Build all production images (no start)
	$(COMPOSE_PROD) build

clean:         ## Stop everything and remove volumes (⚠️ deletes database!)
	@echo "⚠️  This will delete all data including the database."
	@read -p "Are you sure? [y/N] " ans && [ "$$ans" = "y" ]
	$(COMPOSE_PROD) down -v --remove-orphans
	$(COMPOSE_DEV) down -v --remove-orphans

# ── Help ──────────────────────────────────────────────────────────────────────

help:          ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
