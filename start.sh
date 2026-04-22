#!/bin/bash

# Dots and Boxes - Quick Start Script
# This script initializes and starts the development environment

set -e

echo "🎮 Dots and Boxes - Quick Start"
echo "==============================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo "❌ Docker Compose is not available. Please install Docker Desktop or Docker Compose."
    exit 1
fi

echo "✅ Docker and Docker Compose found"
echo ""

# Use Docker Compose v2
DC="docker compose"

# Check if containers are already running
if $DC ps | grep -q "nakama"; then
    echo "ℹ️  Containers already running."
    echo ""
else
    echo "🚀 Starting services (this may take a few minutes on first run)..."
    $DC up -d --build
    
    echo "⏳ Waiting for services to be healthy..."
    sleep 15
    
    # Wait for Nakama to be ready
    echo "⏳ Waiting for Nakama..."
    for i in {1..30}; do
        if curl -s http://localhost:7350/ > /dev/null 2>&1; then
            echo "✅ Nakama is ready!"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "⚠️  Nakama took longer than expected to start."
            echo "   Check logs with: make logs"
        fi
        sleep 2
    done
fi

echo ""
echo "✅ All services started successfully!"
echo ""
echo "📍 Service URLs:"
echo "  🎮 Game Client:    http://localhost:8080"
echo "  🎛️  Nakama Console: http://localhost:7351"
echo "  📡 Nakama API:     http://localhost:7350"
echo "  🗄️  Database:       CockroachDB SQL on localhost:26257"
echo ""
echo "📝 Useful commands:"
echo "  make logs          # View all logs"
echo "  make down          # Stop services"
echo "  make clean         # Remove everything"
echo "  make rebuild       # Rebuild from scratch"
echo ""
echo "🎯 Next steps:"
echo "  1. Open http://localhost:8080 in your browser"
echo "  2. Click 'Create Game'"
echo "  3. Share the Game ID with another player"
echo "  4. Start playing!"
echo ""
echo "🎮 Have fun playing Dots and Boxes!"
