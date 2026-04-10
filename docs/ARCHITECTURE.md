# Multi-Agent Collaborative Desktop Software: Architecture Design

## 1. System Overview

The system follows a **Micro-Agent Architecture** where each agent is an independent lifecycle unit (Identity, Behavior, Tools, Skills). 

### High-level Component Diagram
- **UI (Electron/React)**: Wizard-driven configuration and team management.
- **Agent Runtime**: LLM session orchestration, context management.
- **Team Dispatcher**: Specialized Logic for TL (Team Lead) to manage Member lifecycle.
- **Persistence**: "Behavior-as-Code" via Markdown files.

---

## 2. Communication Protocol (TL-Member)

Communication is asynchronous, using a central **Message Bus** for event-driven coordination.

### Message Schema
```typescript
interface AgentMessage {
  id: string; // Unique message ID
  sender_id: string; // ID of the sender (e.g., TL)
  receiver_id: string | 'ALL'; // Target member ID or broadcast
  type: 'TASK_ASSIGN' | 'TASK_STATUS_UPDATE' | 'FEEDBACK' | 'HEARTBEAT';
  payload: TaskPayload | StatusPayload | FeedbackPayload;
  context_metadata: {
    conversation_id: string;
    parent_task_id?: string; // For task nesting
  };
}

enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked'
}

interface TaskPayload {
  task_id: string;
  subject: string;
  description: string;
  constraints?: string[];
  tools_required?: string[];
}
```

### Dispatcher Logic
1. **TL** creates a `TaskQueue` from user intent.
2. **TL** matches `Member` skills to `TaskPayload`.
3. **Dispatcher** sends `TASK_ASSIGN` message to target `Member`.
4. **Member** updates status via `TASK_STATUS_UPDATE` at intervals.

---

## 3. Core Files Mechanism: "Behavior-as-Code"

Agents are defined by standard Markdown files in their storage directory: `.agents/{agent_id}/core/`.

### File Definitions
- `SOUL.md`: Personality, tone, decision-making logic.
- `IDENTITY.md`: Role, name, description, visual profile.
- `MEMORY.md`: Long-term curated knowledge.

### Processing & Hot-Reloading
```typescript
class CoreFileLoader {
  private watcher: FSWatcher;
  private agentConfig: AgentConfig;

  constructor(agentPath: string) {
    this.watcher = watch(path.join(agentPath, 'core/*.md'), (event, filename) => {
      this.reloadBehavior(filename);
    });
  }

  private async reloadBehavior(filename: string) {
    const content = await readFile(filename, 'utf-8');
    const sections = this.parseMarkdown(content);
    // Re-inject into LLM System Prompt dynamically
    this.agentConfig.updatePrompt(sections);
    this.emit('RELOAD_COMPLETE', { filename });
  }
}
```

---

## 4. UI State Management (Creation Wizard)

The wizard utilizes a **Reactive State Store** to ensure the "Live Preview" is always in sync with the current configuration.

### State Structure
```typescript
const wizardStore = {
  currentStep: 1, // 1: Identity, 2: Tools, 3: Skills, 4: Finalize
  draftAgent: {
    id: null,
    name: '',
    description: '',
    vibe: 'Professional',
    avatar: 'PixelArt-1',
    tools: [],
    skills: [],
    coreFiles: {
      'SOUL.md': '...',
      'IDENTITY.md': '...',
      'MEMORY.md': '...'
    }
  }
};
```

### Sync Flow
- **Step 1-3**: User edits `draftAgent`.
- **Live Preview**: Subscribes to `draftAgent` changes. When `vibe` or `name` changes, the card component re-renders immediately.
- **Finalize**: 
  1. Generate unique `agent_id`.
  2. Write `draftAgent.coreFiles` to disk.
  3. Register Agent in `AgentRegistry`.
  4. Flush `wizardStore`.
