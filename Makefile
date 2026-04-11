# Makefile for CoWork Electron + Python AI Desktop Application

# Variables
PYTHON ?= python3
PIP ?= pip3

.PHONY: help install install-node install-python dev build test clean check-env doctor

help:
	@echo "Available targets:"
	@echo "  help         - Show this help message"
	@echo "  install      - Install all dependencies (Node.js and Python)"
	@echo "  install-node - Install Node.js dependencies only"
	@echo "  install-python - Install Python dependencies only"
	@echo "  check-env    - Check environment requirements"
	@echo "  doctor       - Diagnose common issues"
	@echo "  dev          - Start development server"
	@echo "  build        - Build for production"
	@echo "  test         - Run tests"
	@echo "  clean        - Clean build artifacts"

check-env:
	@echo "Checking environment requirements..."
	@echo "Node.js version:"
	@node --version || (echo "❌ Node.js not found" && exit 1)
	@echo "npm version:"
	@npm --version || (echo "❌ npm not found" && exit 1)
	@echo "Python version (using $(PYTHON)):"
	@$(PYTHON) --version || (echo "❌ $(PYTHON) not found" && exit 1)
	@$(PYTHON) -c "import sys; exit(0) if sys.version_info >= (3, 12) else exit(1)" && \
		echo "✅ Python version meets requirement (>=3.12)" || \
		echo "⚠️  Warning: Python 3.12 or higher is required (see backend/.python-version)"

install-node:
	@echo "Installing Node.js dependencies..."
	npm install
	@echo "Node.js dependencies installed."

install-python:
	@echo "Installing Python dependencies..."
	@echo "Checking Python version (using $(PYTHON))..."
	@$(PYTHON) -c "import sys; exit(0) if sys.version_info >= (3, 12) else exit(1)" || \
		(echo "❌ Python 3.12+ is required. Current version:" && $(PYTHON) --version && echo "You can set PYTHON=python3.12 to use a different Python executable" && exit 1)
	@echo "Checking for pip (using $(PIP))..."
	@cd backend && ($(PIP) install -r requirements.txt || \
		($(PYTHON) -m pip install -r requirements.txt || \
		(echo "❌ pip not found. Trying pip3..." && pip3 install -r requirements.txt || \
		(echo "❌ pip3 not found. Trying pip..." && pip install -r requirements.txt || \
		(echo "❌ pip not found. Please install pip for Python 3.12+" && exit 1))))
	@echo "✅ Python dependencies installed."

install: install-node install-python
	@echo "All dependencies installed."

dev: check-env
	@echo "Starting development server..."
	npm run dev

build: check-env
	@echo "Building for production..."
	npm run build
	@echo "Build completed. Output in dist/ directory."

test: check-env
	@echo "Running tests..."
	npm run test

clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist dist-electron node_modules
	@echo "Clean completed."

# Advanced targets for developers
dev-with-log:
	@echo "Starting dev with logging..."
	npm run dev 2>&1 | tee dev.log

setup-dev: install
	@echo "Development environment setup complete."
	@echo "Run 'make dev' to start the application."

# Docker target (optional)
docker-build:
	@echo "Building Docker image..."
	docker build -t cowork-app .
	@echo "Docker image built."

docker-run:
	@echo "Running Docker container..."
	docker run -p 5173:5173 cowork-app

# Diagnostic target
doctor:
	@echo "Running CoWork doctor..."
	@echo ""
	@echo "=== Environment Check ==="
	@make --no-print-directory check-env
	@echo ""
	@echo "=== Node.js Dependencies ==="
	@if [ -d "node_modules" ]; then \
		echo "✅ node_modules directory exists"; \
	else \
		echo "❌ node_modules directory missing - run 'make install-node'"; \
	fi
	@echo ""
	@echo "=== Python Dependencies ==="
	@echo "Checking if Python packages are installed..."
	@cd backend && $(PYTHON) -c "import pkgutil; \
		import sys; \
		packages=['fastapi', 'openai', 'mem0ai']; \
		for pkg in packages: \
			if pkgutil.find_loader(pkg): print('✅ ' + pkg + ' is installed'); \
			else: print('❌ ' + pkg + ' not found')" 2>/dev/null || \
		echo "⚠️  Could not check Python packages"
	@echo ""
	@echo "=== Port Availability ==="
	@echo "Checking ports 5173, 51234-51236..."
	@for port in 5173 51234 51235 51236; do \
		$(PYTHON) -c "import socket; s=socket.socket(); s.settimeout(0.5); \
			try: s.bind(('127.0.0.1', $$port)); s.close(); print('✅ Port $$port is available'); \
			except: print('⚠️  Port $$port may be in use')" 2>/dev/null || true; \
	done
	@echo ""
	@echo "=== Recommendations ==="
	@$(PYTHON) -c "import sys; exit(0) if sys.version_info >= (3, 12) else exit(1)" 2>/dev/null || \
		echo "• Upgrade Python to 3.12+ (see README for instructions)"
	@if [ ! -d "node_modules" ]; then \
		echo "• Run 'make install-node' to install Node.js dependencies"; \
	fi
	@echo "• Run 'make dev' to start the application"
	@echo ""