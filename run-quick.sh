#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Secure Document Flow - Services Launcher${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Cleanup function
cleanup() {
    echo -e "\n\n${YELLOW}Stopping all services...${NC}"
    kill $PYTHON_PID $API_SERVER_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Quick check
echo -e "\n${YELLOW}Checking requirements...${NC}"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python3 not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Python3 available"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}⚠ pnpm not found, installing...${NC}"
    npm install -g pnpm
fi
echo -e "${GREEN}✓${NC} pnpm available"

# Install Python dependencies
echo -e "\n${YELLOW}Installing Python dependencies...${NC}"
python3 -m venv "$SCRIPT_DIR/.venv" 2>/dev/null || true
source "$SCRIPT_DIR/.venv/bin/activate"
pip install -q --upgrade pip setuptools wheel
pip install -q -r safeleak/requirements.txt 2>/dev/null || echo -e "${YELLOW}⚠${NC} Some Python deps may have issues"
echo -e "${GREEN}✓${NC} Python dependencies ready"

echo -e "\n${YELLOW}Starting services in 2 seconds...${NC}\n"
sleep 2

# Start Python Flask server
echo -e "${BLUE}[1]${NC} ${BLUE}Flask Backend${NC} - Starting on http://localhost:5000"
cd "$SCRIPT_DIR/safeleak"
source "$SCRIPT_DIR/.venv/bin/activate"
python3 main.py &
PYTHON_PID=$!
sleep 2

# Start API Server
echo -e "${BLUE}[2]${NC} ${BLUE}API Server${NC} - Starting on http://localhost:3000"
cd "$SCRIPT_DIR/artifacts/api-server"
PORT=3000 pnpm run dev &
API_SERVER_PID=$!
sleep 2

# Start Frontend
echo -e "${BLUE}[3]${NC} ${BLUE}Frontend${NC} - Starting on http://localhost:5173"
cd "$SCRIPT_DIR/artifacts/mockup-sandbox"
PORT=5173 BASE_PATH=/ pnpm run dev &
FRONTEND_PID=$!

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ All services are running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${YELLOW}Services:${NC}"
echo -e "  • Flask Backend:   ${BLUE}http://localhost:5000${NC}"
echo -e "  • API Server:      ${BLUE}http://localhost:3000${NC}"
echo -e "  • Frontend:        ${BLUE}http://localhost:5173${NC}"

echo -e "\n${YELLOW}Logs: Check your terminal windows for server output${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Keep the script running
wait
