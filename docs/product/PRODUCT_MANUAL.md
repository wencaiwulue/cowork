# CoWork: Multi-Agent Collaborative Desktop Platform

CoWork is a professional desktop application designed for orchestrating, managing, and collaborating with personified AI Agents. It follows a hierarchical "Supervisor" model where teams of specialized agents work together to solve complex tasks.

## 🌟 Core Features

### 1. Agent Management (The Identity Layer)
- **Personified Creation**: Build agents with unique names, avatars, and "Vibes" (Professional, Creative, etc.).
- **Behavior-as-Code**: Agent personalities are defined via Markdown files (`SOUL.md`, `IDENTITY.md`), allowing for precise control and versioning.
- **Capability Injection**: Assign specific tools and skills to each agent from an extensible library.

### 2. Team Orchestration (The Supervisor Layer)
- **Hierarchical Collaboration**: Designate a **Team Lead (TL)** to oversee projects.
- **Autonomous Delegation**: Agents can assign sub-tasks to each other using the `[DELEGATE: @Member]` protocol.
- **Dynamic Context**: Teams share a workspace, and the system automatically injects member skills and roles into the context.

### 3. Integrated Intelligence (The Execution Layer)
- **Streaming Response**: Real-time SSE-based communication for low-latency feedback.
- **Thinking Visibility**: Distinct UI sections for "Reasoning Content," allowing you to see the agent's thought process (compatible with models like DeepSeek).
- **Global LLM Orchestration**: Unified configuration for API Keys, Base URLs, and Models in the system settings.

### 4. Smart Memory (The Persistence Layer)
- **Mem0 Integration**: A self-evolving long-term memory layer that extracts facts and preferences from conversations.
- **Multi-Storage Support**: Switch between Mem0 (Vector), SQLite (Database), or Local File (JSONL) storage.
- **Search & Forget**: Search through historical facts or selectively "forget" specific pieces of information.

### 5. Automation & Extensions
- **Scheduled Tasks**: Built-in Cron scheduler to trigger agent actions (e.g., "Daily Report") with result回传 to the chat.
- **SkillHub**: A marketplace for discovering and installing new capabilities (e.g., Web Scraper, Data Scientist).
- **Integrated File Explorer**: Directly manage and reference project files within the collaboration workspace.

## 🎨 UI & UX
- **3-Pane Professional Layout**: Sidebar (Navigation) | Main (Chat/Library) | Sidebar (Files).
- **Theming**: Full support for Light and Dark modes with instant persistent switching.
- **Rich Interaction**: Keyboard-friendly @mention system, foldering, and session management.

## 🛠 Tech Stack
- **Frontend**: Electron, React, Vite, TypeScript.
- **Backend**: Python 3.12+, FastAPI, OpenAI SDK.
- **Memory**: Mem0, Qdrant (Local), SQLite.
- **Persistence**: Local File System (JSON/Markdown).
