# CoWork - AI Collaboration Desktop Application

An AI collaboration desktop application built with Electron + React + Python FastAPI, integrating various AI
capabilities.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Electron
- **Backend**: Python 3.12+ + FastAPI + Uvicorn
- **AI Integration**: OpenAI, Mem0, Qdrant, etc.

## Environment Requirements

### Required Software

1. **Node.js 18+** (Latest LTS version recommended)
2. **Python 3.12+** (Must be 3.12 or higher)
3. **npm** or **yarn** (Package manager)
4. **pip** (Python package manager)

### Installing Python 3.12

If your system doesn't have Python 3.12, use one of these methods:

#### macOS (using Homebrew)

```bash
brew install python@3.12
# Add Python 3.12 to PATH
echo 'export PATH="/usr/local/opt/python@3.12/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-dev
```

#### Using pyenv (Recommended for managing multiple versions)

```bash
# Install pyenv
curl https://pyenv.run | bash

# Configure shell environment
# Add to ~/.zshrc or ~/.bashrc:
# export PYENV_ROOT="$HOME/.pyenv"
# [[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"

# Install Python 3.12
pyenv install 3.12.0
pyenv local 3.12.0  # Use 3.12 in current directory
```

#### Windows

- Download Python 3.12+ installer from [Python.org](https://www.python.org/downloads/)
- Check "Add Python to PATH" during installation

### Verify Environment

```bash
node --version  # Should show v18.x.x or higher
npm --version   # Should show 8.x.x or higher
python3 --version  # Should show Python 3.12.x or higher
```

## Quick Start

### Method 1: Using Makefile (Recommended)

```bash
# 1. Install all dependencies
make install

# 2. Start development server
make dev
```

### Method 2: Manual Installation

```bash
# 1. Install Node.js dependencies
npm install

# 2. Install Python dependencies
cd backend
pip install -r requirements.txt
cd ..

# 3. Start development server
npm run dev
```

## Makefile Commands Reference

| Command               | Description                                   |
|-----------------------|-----------------------------------------------|
| `make help`           | Show all available commands                   |
| `make check-env`      | Check environment requirements                |
| `make install`        | Install all dependencies (Node.js and Python) |
| `make install-node`   | Install Node.js dependencies only             |
| `make install-python` | Install Python dependencies only              |
| `make dev`            | Start development server                      |
| `make build`          | Build for production                          |
| `make test`           | Run tests                                     |
| `make clean`          | Clean build artifacts                         |

## Project Structure

```
├── src/                    # Frontend Electron application
│   ├── core/              # Core logic
│   ├── ui/                # React components
│   ├── main.ts           # Electron main process
│   └── renderer.tsx      # React renderer process
├── backend/               # Python backend service
│   ├── app/              # FastAPI application modules
│   ├── main.py           # Backend entry point
│   └── requirements.txt  # Python dependencies
├── package.json          # Node.js configuration
├── vite.config.ts        # Vite build configuration
└── Makefile              # Automation scripts
```

## Common Issues

### 1. `vite: command not found`

**Cause**: Node.js dependencies not installed
**Solution**: Run `npm install` or `make install-node`

### 2. `Python version mismatch`

**Cause**: Python version below 3.12
**Solution**:

- Upgrade Python to 3.12+
- Use pyenv to manage multiple Python versions:
  ```bash
  pyenv install 3.12.0
  pyenv local 3.12.0
  ```

### 3. `Port conflicts`

**Cause**: Default ports (5173 frontend, 51234 backend) are occupied
**Solution**:

- Frontend port: Modify `server.port` in `vite.config.ts`
- Backend port: Modify `BACKEND_PORT` lookup logic in `src/main.ts`

### 4. `Python dependency installation failure`

**Cause**: Network issues or dependency conflicts
**Solution**:

```bash
# Try using a mirror (for China)
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# Or use poetry (if supported)
cd backend && poetry install
```

### 5. `Electron security warning`

**Warning**: Current configuration `nodeIntegration: true` has security risks
**Note**: This is development configuration. Production should use `contextBridge` for inter-process communication

### 6. `Makefile variable usage`

**Scenario**: Multiple Python versions on system, need to specify a particular version
**Solution**:

```bash
# Specify Python 3.12 executable path
make install PYTHON=python3.12

# Or use absolute path
make install PYTHON=/usr/local/bin/python3.12

# Can also specify Python version for development
make dev PYTHON=python3.12
```

### 7. `pip command not found`

**Cause**: pip not installed or not in PATH
**Solution**:

```bash
# Install using Python module approach
cd backend && python3 -m pip install -r requirements.txt

# Or let Makefile try multiple approaches
make install-python
```

## Development Notes

### Startup Process

1. Vite starts frontend development server (port 5173)
2. Electron main process starts
3. Electron automatically starts Python backend service (finds available port starting from 51234)
4. Frontend and backend communicate via HTTP API

### Environment Variables

- `BACKEND_URL`: Backend API address (auto-detected by default)
- Other environment variables can be configured via `.env` file (requires backend support)

### Building the Application

```bash
make build
# or
npm run build
```

Build output is in the `dist/` directory

## Troubleshooting

### View Detailed Logs

```bash
# Save development logs to file
make dev-with-log
```

### Complete Reinstall

```bash
make clean
make install
```

### Check Python Version Compatibility

```bash
cd backend
python3 -c "import sys; print('Python version:', sys.version)"
python3 -m pip check
```

## Contributing Guidelines

1. Ensure code passes TypeScript type checking
2. Run tests to verify functionality
3. Follow existing code style

## License

MIT License - see the [LICENSE](LICENSE) file for details.

---

**Tip**: Before first startup, ensure all environment requirements are met, especially Python 3.12+.