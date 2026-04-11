# CoWork - AI协作桌面应用

一个基于Electron + React + Python FastAPI的AI协作桌面应用，集成了多种AI功能。

## 技术栈

- **前端**: React 18 + TypeScript + Vite + Electron
- **后端**: Python 3.12+ + FastAPI + Uvicorn
- **AI集成**: OpenAI, Mem0, Qdrant等

## 环境要求

### 必需软件

1. **Node.js 18+** (推荐最新LTS版本)
2. **Python 3.12+** (必须3.12或更高版本)
3. **npm** 或 **yarn** (包管理器)
4. **pip** (Python包管理器)

### 安装Python 3.12

如果你的系统没有Python 3.12，可以使用以下方法安装：

#### macOS (使用Homebrew)

```bash
brew install python@3.12
# 添加Python 3.12到PATH
echo 'export PATH="/usr/local/opt/python@3.12/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-dev
```

#### 使用pyenv (推荐，可管理多个版本)

```bash
# 安装pyenv
curl https://pyenv.run | bash

# 配置shell环境
# 将以下内容添加到 ~/.zshrc 或 ~/.bashrc:
# export PYENV_ROOT="$HOME/.pyenv"
# [[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"

# 安装Python 3.12
pyenv install 3.12.0
pyenv local 3.12.0  # 在当前目录使用3.12
```

#### Windows

- 从[Python官网](https://www.python.org/downloads/)下载Python 3.12+安装程序
- 安装时勾选"Add Python to PATH"

### 验证环境

```bash
node --version  # 应该显示 v18.x.x 或更高
npm --version   # 应该显示 8.x.x 或更高
python3 --version  # 应该显示 Python 3.12.x 或更高
```

## 快速开始

### 方法一：使用Makefile（推荐）

```bash
# 1. 安装所有依赖
make install

# 2. 启动开发服务器
make dev
```

### 方法二：手动安装

```bash
# 1. 安装Node.js依赖
npm install

# 2. 安装Python依赖
cd backend
pip install -r requirements.txt
cd ..

# 3. 启动开发服务器
npm run dev
```

## Makefile命令参考

| 命令                    | 说明           |
|-----------------------|--------------|
| `make help`           | 显示所有可用命令     |
| `make check-env`      | 检查环境要求       |
| `make install`        | 安装所有依赖       |
| `make install-node`   | 仅安装Node.js依赖 |
| `make install-python` | 仅安装Python依赖  |
| `make dev`            | 启动开发服务器      |
| `make build`          | 构建生产版本       |
| `make test`           | 运行测试         |
| `make clean`          | 清理构建产物       |

## 项目结构

```
├── src/                    # 前端Electron应用
│   ├── core/              # 核心逻辑
│   ├── ui/                # React组件
│   ├── main.ts           # Electron主进程
│   └── renderer.tsx      # React渲染进程
├── backend/               # Python后端服务
│   ├── app/              # FastAPI应用模块
│   ├── main.py           # 后端入口
│   └── requirements.txt  # Python依赖
├── package.json          # Node.js配置
├── vite.config.ts        # Vite构建配置
└── Makefile              # 自动化脚本
```

## 常见问题

### 1. `vite: command not found`

**原因**: Node.js依赖未安装
**解决**: 运行 `npm install` 或 `make install-node`

### 2. `Python版本不匹配`

**原因**: Python版本低于3.12
**解决**:

- 升级Python到3.12+
- 使用pyenv管理多个Python版本：
  ```bash
  pyenv install 3.12.0
  pyenv local 3.12.0
  ```

### 3. `端口冲突`

**原因**: 默认端口(5173前端, 51234后端)被占用
**解决**:

- 前端端口: 修改`vite.config.ts`中的`server.port`
- 后端端口: 修改`src/main.ts`中的`BACKEND_PORT`查找逻辑

### 4. `Python依赖安装失败`

**原因**: 网络问题或依赖冲突
**解决**:

```bash
# 尝试使用国内镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 或使用poetry（如果项目支持）
cd backend && poetry install
```

### 5. `Electron安全警告`

**警告**: 当前配置`nodeIntegration: true`存在安全风险
**说明**: 这是开发配置，生产环境应使用`contextBridge`进行进程间通信

### 6. `Makefile变量使用`

**场景**: 系统中有多个Python版本，需要指定特定版本
**解决**:

```bash
# 指定Python 3.12可执行文件路径
make install PYTHON=python3.12

# 或使用绝对路径
make install PYTHON=/usr/local/bin/python3.12

# 开发时也可以指定Python版本
make dev PYTHON=python3.12
```

### 7. `pip命令未找到`

**原因**: pip未安装或不在PATH中
**解决**:

```bash
# 使用Python模块方式安装
cd backend && python3 -m pip install -r requirements.txt

# 或通过Makefile自动尝试多种方式
make install-python
```

## 开发说明

### 启动流程

1. Vite启动前端开发服务器（端口5173）
2. Electron主进程启动
3. Electron自动启动Python后端服务（从51234端口开始查找可用端口）
4. 前后端通过HTTP API通信

### 环境变量

- `BACKEND_URL`: 后端API地址（默认自动检测）
- 其他环境变量可通过`.env`文件配置（需要后端支持）

### 构建应用

```bash
make build
# 或
npm run build
```

构建产物位于`dist/`目录

## 故障排除

### 查看详细日志

```bash
# 将开发日志保存到文件
make dev-with-log
```

### 完全重新安装

```bash
make clean
make install
```

### 检查Python版本兼容性

```bash
cd backend
python3 -c "import sys; print('Python版本:', sys.version)"
python3 -m pip check
```

## 贡献指南

1. 确保代码通过TypeScript类型检查
2. 运行测试确保功能正常
3. 遵循现有代码风格

## 许可证

MIT许可证 - 详情请参阅 [LICENSE](LICENSE) 文件。

---

**提示**: 首次启动前请确保满足所有环境要求，特别是Python 3.12+。