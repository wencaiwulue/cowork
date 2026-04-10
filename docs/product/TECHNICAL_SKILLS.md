# CoWork: Technical Skillset Definitions

This document outlines the core technical "Skills" provided by the CoWork platform. These are the building blocks that allow agents to interact with the system and each other.

## 🔗 Platform Core Skills

### `llm_orchestration`
- **Description**: Manages communication with LLM providers using OpenAI-compatible APIs.
- **Capabilities**: Streaming (SSE), async processing, base_url/model routing, system prompt injection.

### `hierarchical_collaboration` (The Supervisor Pattern)
- **Description**: Implements the logic for agents to understand team structures and delegate work.
- **Protocol**: `[DELEGATE: @Name] task_description`.
- **Logic**: Automatically triggers new message events on the bus when delegation keywords are detected in agent outputs.

### `long_term_memory` (Mem0)
- **Description**: Extracted knowledge management.
- **Providers**: Mem0 (Vector), SQLite, File System.
- **Operations**: `add_fact`, `search_memories`, `forget_memory`.

### `automation_scheduler` (Cron)
- **Description**: Background task execution engine.
- **Logic**: Maps cron expressions to specific Agent/Team targets and pushes results back to the conversation UI.

## 🧩 Extensible Agent Skills (SkillHub)

| Skill Name | Description | Icon |
|------------|-------------|------|
| `web_scraper` | Extract data and content from public URLs. | 🌐 |
| `data_scientist` | Perform Python-based analysis and chart generation. | 🐍 |
| `image_generator` | Generate visual assets from text prompts. | 🎨 |
| `gmail_manager` | Orchestrate email workflows (draft, read, send). | 📧 |
| `pdf_analyzer` | Deep parsing and summarization of PDF documents. | 📄 |
| `code_auditor` | Perform security and performance reviews on source code. | 🛡️ |

## 📦 Connector Interface
Standardized interface for 3rd party integrations:
- **Slack**: Inbound/Outbound message sync.
- **GitHub**: Repository browsing and issue management.
- **Discord**: Real-time collaboration bridge.
