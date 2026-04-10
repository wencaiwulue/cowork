export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked'
}

export interface TaskPayload {
  task_id: string;
  subject: string;
  description: string;
  constraints?: string[];
  tools_required?: string[];
}

export interface StatusPayload {
  task_id: string;
  status: TaskStatus;
  progress?: number; // 0-100
  message?: string;
}

export interface FeedbackPayload {
  task_id: string;
  result: any;
  artifacts?: string[]; // list of file paths or links
}

export interface AgentMessage {
  id: string; // Unique message ID
  sender_id: string; // ID of the sender (e.g., TL)
  receiver_id: string | 'ALL'; // Target member ID or broadcast
  type: 'TASK_ASSIGN' | 'TASK_STATUS_UPDATE' | 'FEEDBACK' | 'HEARTBEAT';
  payload: TaskPayload | StatusPayload | FeedbackPayload | any;
  context_metadata: {
    conversation_id: string;
    parent_task_id?: string; // For task nesting
  };
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  vibe: string;
  avatar: string;
  tools: string[];
  skills: string[];
  updatePrompt: (sections: Record<string, string>) => void;
}
