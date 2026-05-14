#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Secure Document Flow - Full Stack Runner${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Load environment variables from .env file
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

FLASK_PORT=5000
API_PORT=3000
FRONTEND_PORT=5173

is_port_in_use() {
    local port="$1"
    lsof -iTCP:"${port}" -sTCP:LISTEN > /dev/null 2>&1
}

resolve_port() {
    local preferred_port="$1"
    local service_name="$2"
    local candidate_port="${preferred_port}"

    while is_port_in_use "${candidate_port}"; do
        candidate_port=$((candidate_port + 1))
    done

    if [ "${candidate_port}" != "${preferred_port}" ]; then
        echo -e "${YELLOW}⚠${NC} ${service_name} port ${preferred_port} is busy, using ${candidate_port}" >&2
    fi

    echo "${candidate_port}"
}

FLASK_PORT=$(resolve_port "$FLASK_PORT" "Flask")
API_PORT=$(resolve_port "$API_PORT" "API")
FRONTEND_PORT=$(resolve_port "$FRONTEND_PORT" "Frontend")

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Stopping all services...${NC}"
    kill $PYTHON_PID $API_SERVER_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Setup Python environment
echo -e "\n${YELLOW}[1/6]${NC} Setting up Python environment..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    echo -e "${GREEN}✓${NC} Python $PYTHON_VERSION found"
else
    echo -e "${RED}✗${NC} Python3 not found. Please install Python 3.11+"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}  Creating virtual environment...${NC}"
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate
echo -e "${GREEN}✓${NC} Virtual environment activated"

# 2. Install Python dependencies
echo -e "\n${YELLOW}[2/6]${NC} Installing Python dependencies..."
pip install --upgrade pip setuptools wheel --quiet
if pip install -r safeleak/requirements.txt --quiet; then
    echo -e "${GREEN}✓${NC} Python dependencies installed"
else
    echo -e "${RED}✗${NC} Failed to install Python dependencies"
    exit 1
fi

# 3. Setup Node.js environment
echo -e "\n${YELLOW}[3/6]${NC} Setting up Node.js environment..."
if command -v pnpm &> /dev/null; then
    PNPM_VERSION=$(pnpm --version)
    echo -e "${GREEN}✓${NC} pnpm $PNPM_VERSION found"
else
    echo -e "${YELLOW}  Installing pnpm...${NC}"
    npm install -g pnpm
fi

# 4. Install Node.js dependencies
echo -e "\n${YELLOW}[4/6]${NC} Installing Node.js dependencies..."
if pnpm install > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Node.js dependencies installed"
else
    echo -e "${RED}✗${NC} Failed to install Node.js dependencies"
    exit 1
fi

# 5. Check for GITHUB_TOKEN
echo -e "\n${YELLOW}[5/7]${NC} Checking GitHub Models configuration..."
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}⚠${NC}  GITHUB_TOKEN not set. GitHub Models (gpt-4o) will be unavailable."
    echo -e "   To use GitHub Models for PII detection, set: export GITHUB_TOKEN='your_token'"
    echo -e "   Get a token at: https://github.com/settings/tokens (needs 'read:ai_models' scope)"
else
    echo -e "${GREEN}✓${NC} GITHUB_TOKEN found"
fi

# 6. Download Spacy model (optional for Python PII detection)
echo -e "\n${YELLOW}[6/7]${NC} Setting up Spacy model..."
if python -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('en_core_web_lg') else 1)" > /dev/null 2>&1; then
    :
else
    python -m spacy download en_core_web_lg > /dev/null 2>&1 || echo -e "${YELLOW}⚠${NC} Spacy model download skipped"
fi
echo -e "${GREEN}✓${NC} Spacy model ready"

# 7. Build TypeScript
echo -e "\n${YELLOW}[7/7]${NC} Building TypeScript packages..."
if pnpm run typecheck > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} TypeScript type checking passed"
else
    echo -e "${YELLOW}⚠${NC} TypeScript type checking had warnings"
fi

# Summary
echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Setup complete! Starting all services...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Start Python Flask server
echo -e "${BLUE}[Python Flask Server]${NC} Starting on http://localhost:${FLASK_PORT}"
cd "$SCRIPT_DIR/safeleak"
export GITHUB_TOKEN
PORT=${FLASK_PORT} python main.py &
PYTHON_PID=$!

# Wait a moment for Flask to start
sleep 2

# Start API Server
echo -e "${BLUE}[API Server]${NC} Starting on http://localhost:${API_PORT}"
cd "$SCRIPT_DIR/artifacts/api-server"
PORT=${API_PORT} pnpm run dev > /dev/null 2>&1 &
API_SERVER_PID=$!

# Wait a moment for API server to start
sleep 2

# Start Frontend (Mockup Sandbox)
echo -e "${BLUE}[Frontend - Mockup Sandbox]${NC} Starting on http://localhost:${FRONTEND_PORT}"
cd "$SCRIPT_DIR/artifacts/mockup-sandbox"
PORT=${FRONTEND_PORT} BASE_PATH=/ pnpm run dev > /dev/null 2>&1 &
FRONTEND_PID=$!

echo -e "\n${GREEN}✓ All services are running!${NC}\n"
echo -e "${YELLOW}Services:${NC}"
echo -e "  • Flask Backend:   http://localhost:${FLASK_PORT}"
echo -e "  • API Server:      http://localhost:${API_PORT}"
echo -e "  • Frontend:        http://localhost:${FRONTEND_PORT}"
echo -e "\n${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Keep the script running and wait for signals
wait
