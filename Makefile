.PHONY: help build up down logs client-logs nakama-logs clean ps

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
	@echo "  make clean           - Remove containers and volumes"
	@echo "  make rebuild         - Rebuild and restart"
	@echo "  make ps              - Show running containers"
	@echo ""
	@echo "Services:"
	@echo "  - Nakama Server: http://localhost:7350 (HTTP), ws://localhost:7350 (WebSocket)"
	@echo "  - Nakama Console: http://localhost:7351"
	@echo "  - Client: http://localhost:8080"
	@echo "  - PostgreSQL: localhost:5432"

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
	docker compose exec postgres psql -U nakama -d nakama

shell-nakama:
	docker compose exec nakama sh

# Development targets
dev: up
	@echo "Development environment running"
	@echo "Open http://localhost:8080 in your browser"
