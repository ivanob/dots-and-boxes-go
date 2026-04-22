.PHONY: help build up down logs client-logs nakama-logs clean ps test-client test-server build-client

help:
	@echo "Dots and Boxes - Multiplayer Game"
	@echo "=================================="
	@echo ""
	@echo "Available commands:"
	@echo "  make up              - Start the development environment"
	@echo "  make down            - Stop all services"
	@echo "  make logs            - View all logs"
	@echo "  make nakama-logs     - View Nakama logs"
	@echo "  make client-logs     - View client logs"
	@echo "  make test-client     - Run client unit tests"
	@echo "  make test-server     - Run server unit tests"
	@echo "  make build-client    - Build a single-file client bundle for static hosting"
	@echo "                          Optional env: CLIENT_SERVER_HOST, CLIENT_SERVER_PORT, CLIENT_SERVER_USE_SSL"
	@echo "  make clean           - Remove containers and volumes"
	@echo "  make rebuild         - Rebuild and restart"
	@echo "  make ps              - Show running containers"
	@echo ""
	@echo "Services:"
	@echo "  - Nakama Server: http://localhost:7350 (HTTP), ws://localhost:7350 (WebSocket)"
	@echo "  - Nakama Console: http://localhost:7351"
	@echo "  - Client: http://localhost:8080"
	@echo "  - CockroachDB SQL: localhost:26257"

up:
	docker compose up -d
	@echo ""
	@echo "Services started!"
	@echo "Client: http://localhost:8080"
	@echo "Nakama Console: http://localhost:7351"

down:
	docker compose down

logs:
	docker compose logs -f

nakama-logs:
	docker compose logs -f nakama

client-logs:
	docker compose logs -f client

clean:
	docker compose down -v
	@echo "Cleaned up containers and volumes"

rebuild:
	docker compose down
	docker compose build --no-cache
	docker compose up -d
	@echo "Rebuild complete!"

ps:
	docker compose ps

shell-db:
	docker compose exec cockroachdb cockroach sql --certs-dir=/cockroach/certs --host=localhost:26257

shell-nakama:
	docker compose exec nakama sh

test-client:
	cd client && npm test

test-server:
	docker run --rm -v "$$(pwd)/server/go_modules:/src" -w /src golang:1.22 go test ./...

build-client:
	cd client && npm run build

# Development targets
dev: up
	@echo "Development environment running"
	@echo "Open http://localhost:8080 in your browser"
