import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getBackendUrl } from '../utils/config';
import { MessageBus } from '../core/MessageBus';
import { AgentMessage } from '../types/agent';
import TeamManagementModal from './TeamManagementModal';

// ─── Global Stream Registry ──────────────────────────────────────────────────
// 设计原则：
//   每个 convoId 对应一条 fetch POST 长连接（SSE）。
//   连接存在模块级 Map 里，完全脱离 React 生命周期。
//   切换 session 只是把 listener 换掉，fetch 连接继续在后台读取数据。
//   只有用户点 Stop 才会 abort 连接。

type StreamEvent =
  | { type: 'chunk'; agentId: string; agentName: string; content: string; reasoning: string }
  | { type: 'agent_done'; agentId: string }
  | { type: 'todos'; todos: any[] }
  | { type: 'orchestration_done'; final: string }
  | { type: 'stream_done' }
  | { type: 'error'; message: string }
  | { type: 'stream_state'; status: 'connecting' | 'streaming' | 'done' | 'error'; agentId?: string; agentName?: string };

type StreamListener = (event: StreamEvent) => void;

interface StreamEntry {
  abort: AbortController;
  listener: StreamListener | null;  // 当前活跃的 listener（只有一个）
  buffer: StreamEvent[];            // listener 不在时缓存事件
  done: boolean;                    // fetch 已结束
}

const _registry = new Map<string, StreamEntry>();

// Track stream state per conversation
interface StreamState {
  status: 'connecting' | 'streaming' | 'done' | 'error';
  hasReceivedChunk: boolean;
  agentId?: string;
  agentName?: string;
}

const _streamStates = new Map<string, StreamState>();

export function getStreamState(convoId: string): StreamState | undefined {
  return _streamStates.get(convoId);
}

export function isStreamConnecting(convoId: string): boolean {
  const state = _streamStates.get(convoId);
  return !!state && state.status === 'connecting';
}

function _parseSSEData(data: any): StreamEvent | null {
  if (data.todos)              return { type: 'todos', todos: data.todos };
  if (data.orchestration_done) return { type: 'orchestration_done', final: data.final || '' };
  if (data.stream_done)        return { type: 'stream_done' };
  if (data.error)              return { type: 'error', message: data.error };
  if (data.done)               return { type: 'agent_done', agentId: data.agent_id };
  if (data.agent_id)           return {
    type: 'chunk',
    agentId: data.agent_id,
    agentName: data.agent || data.agent_id,
    content: data.content || '',
    reasoning: data.reasoning || '',
  };
  return null;
}

function _emit(entry: StreamEntry, event: StreamEvent) {
  // 非终止事件放入 buffer（供 listener 缺席时积累）
  if (event.type !== 'stream_done' && event.type !== 'error') {
    entry.buffer.push(event);
  }
  if (entry.listener) {
    try { entry.listener(event); } catch {}
  }
}

/** 启动一条新的 SSE 长连接。convoId 已有连接则不重复创建。*/
function _startStream(convoId: string, backendUrl: string, body: object) {
  if (_registry.has(convoId)) return;

  const abort = new AbortController();
  const entry: StreamEntry = { abort, listener: null, buffer: [], done: false };
  _registry.set(convoId, entry);

  // Extract agent info from body for connecting state
  const agentId = (body as any).agent_id || (body as any).type || 'team';
  const agentName = (body as any).agent_name || agentId;

  // Set initial connecting state
  _streamStates.set(convoId, { status: 'connecting', hasReceivedChunk: false, agentId, agentName });

  // Notify listener about connecting state
  _emit(entry, { type: 'stream_state', status: 'connecting', agentId, agentName } as any);

  console.log(`[Stream] POST /messages/${convoId}/stream`, body);

  // 这个 async IIFE 永远不会被 GC，因为 entry 持有 abort，_registry 持有 entry
  (async () => {
    try {
      const res = await fetch(`${backendUrl}/messages/${encodeURIComponent(convoId)}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        console.error(`[Stream] HTTP ${res.status} for convoId=${convoId}`, errText);
        _streamStates.set(convoId, { status: 'error', hasReceivedChunk: false, agentId, agentName });
        _emit(entry, { type: 'error', message: `HTTP ${res.status}: ${errText}` });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const event = _parseSSEData(JSON.parse(raw));
            if (event) {
              // On first chunk, transition to streaming state
              if (event.type === 'chunk') {
                const currentState = _streamStates.get(convoId);
                if (currentState && !currentState.hasReceivedChunk) {
                  _streamStates.set(convoId, { ...currentState, status: 'streaming', hasReceivedChunk: true });
                  _emit(entry, { type: 'stream_state', status: 'streaming', agentId: event.agentId, agentName: event.agentName } as any);
                }
              }
              _emit(entry, event);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        _streamStates.set(convoId, { status: 'error', hasReceivedChunk: false, agentId, agentName });
        _emit(entry, { type: 'error', message: String(err) });
      }
    } finally {
      entry.done = true;
      // Mark stream as done
      const currentState = _streamStates.get(convoId);
      if (currentState) {
        _streamStates.set(convoId, { ...currentState, status: 'done' });
      }
      // 如果 listener 在线，直接通知；否则等 listener 来取时再通知
      if (entry.listener) {
        try { entry.listener({ type: 'stream_done' }); } catch {}
        _registry.delete(convoId);
        _streamStates.delete(convoId);
      }
      // 无 listener 时保留 entry（buffer + done=true），等 registerListener 来消费
    }
  })();
}

export function startTeamStream(convoId: string, teamName: string, message: string, history: any[], backendUrl: string) {
  _startStream(convoId, backendUrl, { type: 'team', team_name: teamName, message, history });
}

export function startAgentStream(convoId: string, agentId: string, message: string, history: any[], backendUrl: string) {
  _startStream(convoId, backendUrl, { type: 'agent', agent_id: agentId, message, history });
}

export function isStreamActive(convoId: string): boolean {
  const e = _registry.get(convoId);
  return !!e && !e.done;
}

export function stopStream(convoId: string) {
  const e = _registry.get(convoId);
  if (e) { e.abort.abort(); _registry.delete(convoId); }
}

/**
 * 注册当前 session 的 listener。
 * - 立即回放 buffer 中积累的历史事件
 * - 如果流已结束（done=true），回放 stream_done 让 UI 收尾
 * - 同一时刻只有一个 listener（切 session 时旧的被换掉）
 * 返回取消注册函数（只是置 null，不 abort 连接）
 */
export function registerListener(convoId: string, listener: StreamListener): () => void {
  const entry = _registry.get(convoId);
  if (!entry) return () => {};

  // 先同步当前 stream 状态（解决 connecting 状态丢失问题）
  const streamState = _streamStates.get(convoId);
  if (streamState && !entry.done) {
    try {
      listener({ type: 'stream_state', status: streamState.status, agentId: streamState.agentId, agentName: streamState.agentName } as any);
    } catch {}
  }

  // 回放 buffer 中积累的事件（包括切换期间的事件）
  for (const ev of entry.buffer) {
    try { listener(ev); } catch {}
  }

  if (entry.done) {
    try { listener({ type: 'stream_done' }); } catch {}
    _registry.delete(convoId);
    return () => {};
  }

  entry.listener = listener;
  return () => {
    const e = _registry.get(convoId);
    if (e && e.listener === listener) e.listener = null;
  };
}

interface Team {
  name: string;
  agents: string[];
  tl_id?: string;
}

interface Agent {
  id: string;
  name: string;
  avatar: string;
  description: string;
  skills: string[];
  vibe: string;
}

interface Session {
  id: string;
  name: string;
  target_id: string;
  target_type: 'agent' | 'team';
}

interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'high' | 'medium' | 'low';
}

interface TeamChatProps {
  selectedTeamName: string;
  showFiles: boolean;
  onToggleFiles: () => void;
}

// ─── Todo Panel ───────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  in_progress: '◎',
  completed: '✓',
  cancelled: '✗',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--text-secondary)',
  in_progress: '#007aff',
  completed: '#34c759',
  cancelled: '#ff453a',
};

const TodoPanel: React.FC<{ todos: Todo[]; onClose: () => void }> = ({ todos, onClose }) => {
  const hasActive = todos.some(t => t.status === 'in_progress');
  const done = todos.filter(t => t.status === 'completed').length;

  return (
    <div style={{
      position: 'absolute', top: '60px', right: '16px', zIndex: 100,
      width: '280px', background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: '600', fontSize: '13px' }}>Tasks {done}/{todos.length}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
        {todos.map((todo) => (
          <div key={todo.id} style={{
            padding: '10px 16px', display: 'flex', gap: '10px', alignItems: 'flex-start',
            background: todo.status === 'in_progress' ? 'rgba(0,122,255,0.06)' : 'transparent',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ color: STATUS_COLOR[todo.status] || 'var(--text-secondary)', fontSize: '16px', marginTop: '1px', flexShrink: 0 }}>
              {STATUS_ICON[todo.status] || '○'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '13px', lineHeight: '1.4',
                color: todo.status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
                textDecoration: todo.status === 'cancelled' ? 'line-through' : 'none',
              }}>
                {todo.content}
              </div>
              {todo.priority && todo.priority !== 'medium' && (
                <span style={{ fontSize: '10px', color: todo.priority === 'high' ? '#ff453a' : 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase', marginTop: '2px', display: 'block' }}>
                  {todo.priority}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Tool Execution Panel ─────────────────────────────────────────────────────

const ToolExecutionPanel: React.FC<{
  toolExecutions: Array<{
    id: string;
    tool_name: string;
    call_id: string;
    status: 'pending' | 'running' | 'success' | 'error';
    arguments?: any;
    result?: any;
    error?: string;
    timestamp: number;
  }>;
  onClose: () => void;
}> = ({ toolExecutions, onClose }) => {
  const hasRunning = toolExecutions.some(t => t.status === 'running');
  const completed = toolExecutions.filter(t => t.status === 'success' || t.status === 'error').length;

  const formatArguments = (args: any): string => {
    if (!args) return '';
    if (typeof args === 'string') return args;
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  };

  const formatResult = (result: any): string => {
    if (!result) return '';
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  };

  const STATUS_COLORS = {
    pending: 'var(--text-secondary)',
    running: '#007aff',
    success: '#34c759',
    error: '#ff453a',
  };

  const STATUS_ICONS = {
    pending: '○',
    running: '⟳',
    success: '✓',
    error: '✗',
  };

  return (
    <div style={{
      position: 'absolute', top: '60px', right: '16px', zIndex: 99,
      width: '320px', background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: '600', fontSize: '13px' }}>Tools {completed}/{toolExecutions.length}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {toolExecutions.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            No tools executed yet
          </div>
        ) : (
          toolExecutions.map((tool) => (
            <div key={tool.id} style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: tool.status === 'running' ? 'rgba(0,122,255,0.06)' : 'transparent',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    color: STATUS_COLORS[tool.status] || 'var(--text-secondary)',
                    fontSize: '14px',
                    animation: tool.status === 'running' ? 'spin 1s linear infinite' : 'none'
                  }}>
                    {STATUS_ICONS[tool.status] || '○'}
                  </span>
                  <span style={{ fontWeight: '600', fontSize: '13px' }}>{tool.tool_name}</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {new Date(tool.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {tool.arguments && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Arguments:</div>
                  <pre style={{
                    margin: 0,
                    padding: '8px',
                    background: 'rgba(0,0,0,0.05)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    overflowX: 'auto',
                    maxHeight: '100px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {formatArguments(tool.arguments)}
                  </pre>
                </div>
              )}

              {tool.status === 'success' && tool.result && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#34c759', marginBottom: '4px' }}>Result:</div>
                  <pre style={{
                    margin: 0,
                    padding: '8px',
                    background: 'rgba(52,199,89,0.1)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    overflowX: 'auto',
                    maxHeight: '100px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {formatResult(tool.result)}
                  </pre>
                </div>
              )}

              {tool.status === 'error' && tool.error && (
                <div>
                  <div style={{ fontSize: '11px', color: '#ff453a', marginBottom: '4px' }}>Error:</div>
                  <pre style={{
                    margin: 0,
                    padding: '8px',
                    background: 'rgba(255,69,58,0.1)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    overflowX: 'auto',
                    maxHeight: '100px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {tool.error}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const TeamChat: React.FC<TeamChatProps> = ({ selectedTeamName, showFiles, onToggleFiles }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showMembersPopover, setShowMembersPopover] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  // Use stream status from SSE connection
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'streaming' | 'done' | 'error'>('idle');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [showTodos, setShowTodos] = useState(false);
  const [toolExecutions, setToolExecutions] = useState<Array<{
    id: string;
    tool_name: string;
    call_id: string;
    status: 'pending' | 'running' | 'success' | 'error';
    arguments?: any;
    result?: any;
    error?: string;
    timestamp: number;
  }>>([]);
  const [showToolExecutions, setShowToolExecutions] = useState(false);

  const currentIdRef = useRef(selectedTeamName);
  useEffect(() => { currentIdRef.current = selectedTeamName; }, [selectedTeamName]);

  // Always-fresh snapshot of messages — used inside async callbacks to avoid stale closures
  const messagesRef = useRef<AgentMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Per-conversation in-progress message tracker (convoId -> {agentId -> messageId})
  const partialIdsMapRef = useRef<Record<string, Record<string, string>>>({});

  const backendUrl = getBackendUrl();
  const bus = MessageBus.getInstance();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find(s => s.id === selectedTeamName) || null;
  const selectedTeam = currentSession?.target_type === 'team'
    ? teams.find(t => t.name === currentSession.target_id)
    : teams.find(t => t.name === selectedTeamName) || null;

  const selectedAgent = (() => {
    if (currentSession?.target_type === 'agent') {
      return agents.find(a => a.id === currentSession.target_id) ?? null;
    }
    if (selectedTeam) return null;
    // new-draft: pick first available agent
    if (selectedTeamName.startsWith('new-draft-')) {
      return agents.length > 0 ? agents[0] : null;
    }
    // legacy: selectedTeamName might be an agent id
    return agents.find(a => a.id === selectedTeamName) ?? null;
  })();

  const teamAgents = selectedTeam
    ? agents.filter(a => selectedTeam.agents.includes(a.id))
    : selectedAgent ? [selectedAgent] : [];

  const isSingleAgent = !!selectedAgent && !selectedTeam;

  const fetchData = async () => {
    console.log('[fetchData] backendUrl=', backendUrl);
    try {
      const [tRes, aRes, sRes] = await Promise.all([
        fetch(`${backendUrl}/teams`),
        fetch(`${backendUrl}/agents`),
        fetch(`${backendUrl}/sessions`),
      ]);
      console.log('[fetchData] teams:', tRes.status, 'agents:', aRes.status, 'sessions:', sRes.status);
      if (tRes.ok) setTeams(await tRes.json());
      if (aRes.ok) setAgents(await aRes.json());
      if (sRes.ok) setSessions(await sRes.json());
    } catch (e) {
      console.error('[fetchData] FAILED:', e);
    }
  };

  const fetchTodos = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`${backendUrl}/agents/${agentId}/todos`);
      if (res.ok) {
        const data = await res.json();
        setTodos(data.todos || []);
      }
    } catch {}
  }, [backendUrl]);

  // ── 切换 session：重置 UI，加载历史，订阅流 ────────────────────────────────
  useEffect(() => {
    setTodos([]);
    setShowTodos(false);
    setToolExecutions([]);
    setShowToolExecutions(false);
    // 根据全局 _streamStates 恢复 stream status
    const streamState = _streamStates.get(selectedTeamName);
    const active = isStreamActive(selectedTeamName);
    if (streamState) {
      // 从全局状态恢复
      setStreamStatus(streamState.status);
    } else {
      setStreamStatus(active ? 'streaming' : 'idle');
    }
    // 注意：不要在这里重置 partialIdsMapRef，需要保留各个会话的状态
    setIsOrchestrating(active || (streamState?.status === 'connecting' || streamState?.status === 'streaming'));

    // 加载持久化历史消息
    if (selectedTeamName && !selectedTeamName.startsWith('new-draft-')) {
      fetch(`${backendUrl}/messages/${encodeURIComponent(selectedTeamName)}`)
        .then(r => r.json())
        .then((data: AgentMessage[]) => {
          // buffer 里的 chunk 合并后追加在历史之后
          const entry = _registry.get(selectedTeamName);
          if (!entry || entry.buffer.length === 0) {
            setMessages(data);
            return;
          }
          const merged: Record<string, { id: string; content: string; reasoning: string }> = {};
          for (const ev of entry.buffer) {
            if (ev.type !== 'chunk') continue;
            if (!merged[ev.agentId]) merged[ev.agentId] = { id: `stream-${ev.agentId}-replay`, content: '', reasoning: '' };
            merged[ev.agentId].content += ev.content;
            merged[ev.agentId].reasoning += ev.reasoning;
          }
          const doneSet = new Set(entry.buffer.filter(e => e.type === 'agent_done').map(e => (e as any).agentId as string));
          const streamMsgs: AgentMessage[] = [];
          const newPartials: Record<string, string> = {};
          for (const [agentId, { id, content, reasoning }] of Object.entries(merged)) {
            const isPartial = !doneSet.has(agentId);
            streamMsgs.push({ id, sender_id: agentId, receiver_id: 'User', type: 'FEEDBACK', payload: { content, reasoning, is_partial: isPartial }, context_metadata: { conversation_id: selectedTeamName } });
            if (isPartial) newPartials[agentId] = id;
          }
          partialIdsMapRef.current[selectedTeamName] = newPartials;
          const streamIds = new Set(streamMsgs.map(m => m.id));
          setMessages([...data.filter(m => !streamIds.has(m.id)), ...streamMsgs]);
          // 注意：不要在这里清空 buffer，让 registerListener 来回放切换期间的事件
        })
        .catch(() => {});
    } else {
      setMessages([]);
    }

    // 订阅该 session 的流事件
    const convoId = selectedTeamName;
    const listener: StreamListener = (event) => {
      if (event.type === 'chunk') {
        const { agentId, agentName, content, reasoning } = event;
        setMessages(prev => {
          const convoPartials = partialIdsMapRef.current[convoId] || {};
          const existingId = convoPartials[agentId];
          if (existingId) {
            return prev.map(m => m.id !== existingId ? m : {
              ...m, payload: { content: (m.payload.content || '') + content, reasoning: (m.payload.reasoning || '') + reasoning, is_partial: true },
            });
          }
          const newId = `stream-${agentId}-${Date.now()}`;
          if (!partialIdsMapRef.current[convoId]) partialIdsMapRef.current[convoId] = {};
          partialIdsMapRef.current[convoId][agentId] = newId;
          return [...prev, { id: newId, sender_id: agentId, receiver_id: 'User', type: 'FEEDBACK' as const, payload: { content, reasoning, is_partial: true }, context_metadata: { conversation_id: convoId } }];
        });
      } else if (event.type === 'agent_done') {
        const convoPartials = partialIdsMapRef.current[convoId] || {};
        const msgId = convoPartials[event.agentId];
        if (msgId) {
          setMessages(prev => prev.map(m => {
            if (m.id !== msgId) return m;
            const final = { ...m, payload: { ...m.payload, is_partial: false } };
            fetch(`${backendUrl}/messages/${encodeURIComponent(convoId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(final) }).catch(() => {});
            return final;
          }));
          delete partialIdsMapRef.current[convoId][event.agentId];
        }
      } else if (event.type === 'todos') {
        setTodos(event.todos);
        setShowTodos(true);
      } else if (event.type === 'orchestration_done') {
        const finalId = `final-${Date.now()}`;
        const finalMsg: AgentMessage = { id: finalId, sender_id: 'Team', receiver_id: 'User', type: 'FEEDBACK', payload: { content: event.final }, context_metadata: { conversation_id: convoId } };
        setMessages(prev => [...prev, finalMsg]);
        fetch(`${backendUrl}/messages/${encodeURIComponent(convoId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalMsg) }).catch(() => {});
      } else if (event.type === 'stream_done') {
        setIsOrchestrating(false);
        setStreamStatus('done');
        delete partialIdsMapRef.current[convoId];
      } else if (event.type === 'error') {
        console.error('Stream error:', event.message);
        setIsOrchestrating(false);
        setStreamStatus('error');
      } else if (event.type === 'stream_state') {
        setStreamStatus(event.status);
      }
    };

    const unregister = registerListener(convoId, listener);
    return unregister;
  }, [selectedTeamName, backendUrl]);

  useEffect(() => {
    const handleMessage = async (msg: AgentMessage) => {
      const cid = msg.context_metadata.conversation_id;
      const current = currentIdRef.current;
      const isMatch = cid === current || (current.startsWith('new-draft-') && msg.sender_id === 'User');
      console.log('[bus] msg type=', msg.type, 'sender=', msg.sender_id, 'cid=', cid, 'current=', current, 'isMatch=', isMatch);
      if (!isMatch) return;

      // TASK_STATUS_UPDATE is ephemeral — keep in a separate map, NOT in messages array
      // Note: thinking state is now determined by SSE connection status, not TASK_STATUS_UPDATE
      if (msg.type === 'TASK_STATUS_UPDATE') {
        return;
      }

      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });

      if (msg.type !== 'HEARTBEAT' && !msg.payload?.is_partial) {
        fetch(`${backendUrl}/messages/${encodeURIComponent(cid)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        }).catch(() => {});
      }

      // Single-agent task: kick off a persistent stream via registry
      if (msg.type === 'TASK_ASSIGN' && msg.receiver_id !== 'ALL' && msg.receiver_id !== 'User' && msg.receiver_id !== 'TEAM_PLAN') {
        console.log('[sendMsg] TASK_ASSIGN received, receiver_id=', msg.receiver_id, 'cid=', cid, 'agents=', agents.map(a=>a.id));
        const receiverAgent = agents.find(a => a.id === msg.receiver_id);
        if (!receiverAgent) {
          console.warn('[sendMsg] receiverAgent NOT FOUND for id=', msg.receiver_id);
          return;
        }

        setIsOrchestrating(true);
        setStreamStatus('connecting');

        const history = messagesRef.current.slice(-10).map(m => ({
          role: m.sender_id === 'User' ? 'user' : 'assistant',
          content: m.payload.content || (typeof m.payload === 'string' ? m.payload : ''),
        }));

        console.log('[sendMsg] calling startAgentStream cid=', cid, 'agentId=', msg.receiver_id);
        startAgentStream(cid, msg.receiver_id, msg.payload.content, history, backendUrl);
      }
    };

    bus.on('message', handleMessage);
    return () => { bus.off('message', handleMessage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, selectedTeamName, backendUrl]);

  // 组件挂载时加载基础数据
  useEffect(() => { fetchData(); }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleStopStream = () => {
    stopStream(selectedTeamName);
    setIsOrchestrating(false);
    setStreamStatus('idle');
    delete partialIdsMapRef.current[selectedTeamName];
  };

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = async () => {
    console.log('[sendMessage] selectedTeam=', selectedTeam, 'selectedAgent=', selectedAgent, 'selectedTeamName=', selectedTeamName, 'agents=', agents.length, 'sessions=', sessions.length);
    if (!inputValue.trim() || (!selectedTeam && !selectedAgent)) return;

    let convoId = selectedTeamName;
    if (selectedTeamName.startsWith('new-draft-') && selectedAgent) {
      const name = inputValue.slice(0, 30) + (inputValue.length > 30 ? '...' : '');
      try {
        const res = await fetch(`${backendUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_id: selectedAgent.id, target_type: 'agent' }),
        });
        if (res.ok) {
          const s = await res.json();
          convoId = s.id;
          window.dispatchEvent(new CustomEvent('session-created', { detail: convoId }));
        }
      } catch {}
    }

    // 只在非 draft 情况下发送 FEEDBACK 消息到消息总线
    // draft 情况下会通过 TASK_ASSIGN 触发 stream，不需要重复添加消息
    if (!selectedTeamName.startsWith('new-draft-')) {
      const userMsg: AgentMessage = {
        id: `u-${Date.now()}`, sender_id: 'User', receiver_id: 'ALL', type: 'FEEDBACK',
        payload: { content: inputValue },
        context_metadata: { conversation_id: convoId },
      };
      bus.publish(userMsg);
    }

    const hist = messagesRef.current.slice(-10).map(m => ({
      role: m.sender_id === 'User' ? 'user' : 'assistant',
      content: m.payload.content || (typeof m.payload === 'string' ? m.payload : ''),
    }));

    const mentions = inputValue.match(/@([^\s!?,.:;]+)/g);
    if (mentions) {
      mentions.forEach(m => {
        const name = m.slice(1);
        const agent = agents.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (agent && (selectedTeam?.agents.includes(agent.id) || selectedAgent?.id === agent.id)) {
          bus.publish({
            id: `task-${Date.now()}-${agent.id}`, sender_id: 'User', receiver_id: agent.id, type: 'TASK_ASSIGN',
            payload: { task_id: `task-${Date.now()}`, status: 'pending', content: inputValue.replace(m, '').trim() },
            context_metadata: { conversation_id: convoId },
          });
        }
      });
    } else if (selectedAgent) {
      bus.publish({
        id: `t-${Date.now()}`, sender_id: 'User', receiver_id: selectedAgent.id, type: 'TASK_ASSIGN',
        payload: { task_id: `task-${Date.now()}`, status: 'pending', content: inputValue.trim() },
        context_metadata: { conversation_id: convoId },
      });
    } else if (selectedTeam) {
      setIsOrchestrating(true);
      setStreamStatus('connecting');
      // Snapshot team name now — survives selectedTeam becoming null on re-render
      const teamName = selectedTeam.name;
      startTeamStream(convoId, teamName, inputValue.trim(), hist, backendUrl);
    }

    setInputValue('');
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatMessageContent = (payload: any) => {
    let content = payload.content || (typeof payload === 'string' ? payload : '');
    let reasoning = payload.reasoning || '';
    // Extract <think> tags
    const m = content.match(/<(think|thought)>([\s\S]*?)<\/\1>/i) || content.match(/<(think|thought)>([\s\S]*)$/i);
    if (m) { reasoning = (reasoning + '\n' + m[2]).trim(); content = content.replace(m[0], '').trim(); }
    // Strip todo JSON blocks from display
    content = content.replace(/```(?:json)?\s*\{[^`]*"todos"\s*:\s*\[[^\]]*\][^`]*\}\s*```/gs, '').trim();
    return { content, reasoning };
  };

  const headerTitle = selectedTeam
    ? selectedTeam.name
    : selectedAgent
      ? selectedAgent.name
      : selectedTeamName.startsWith('new-draft-') ? 'New Message' : selectedTeamName;

  const hasActiveTodo = todos.some(t => t.status === 'in_progress');
  const todoDone = todos.filter(t => t.status === 'completed').length;

  const hasRunningTools = toolExecutions.some(t => t.status === 'running');
  const completedTools = toolExecutions.filter(t => t.status === 'success' || t.status === 'error').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)', position: 'relative' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-primary)' }}>
        <div style={{ fontWeight: '600', fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{headerTitle}</span>
          {selectedTeam && (
            <div onClick={() => setShowMembersPopover(!showMembersPopover)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '20px' }}>
              <div style={{ display: 'flex' }}>
                {teamAgents.slice(0, 4).map((a, i) => (
                  <div key={a.id} style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--bg-hover)', border: '2px solid var(--bg-primary)', marginLeft: i === 0 ? 0 : '-8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>{a.avatar}</div>
                ))}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{teamAgents.length}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Stop button — only when stream is active */}
          {isOrchestrating && (
            <button
              onClick={handleStopStream}
              style={{
                padding: '5px 12px', borderRadius: '20px', border: '1px solid #ff453a',
                background: 'transparent', color: '#ff453a',
                cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px',
              }}
            >
              ■ Stop
            </button>
          )}
          {/* Todo button — show when there are todos */}
          {todos.length > 0 && (
            <button
              onClick={() => setShowTodos(!showTodos)}
              style={{
                padding: '5px 12px', borderRadius: '20px', border: '1px solid var(--border)',
                background: showTodos ? 'var(--accent)' : 'var(--bg-input)',
                color: showTodos ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {hasActiveTodo && (
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%', background: '#007aff',
                  animation: 'pulse 1.5s infinite',
                }} />
              )}
              {todoDone}/{todos.length} tasks
            </button>
          )}
          {/* Tool execution button — show when there are tool executions */}
          {toolExecutions.length > 0 && (
            <button
              onClick={() => setShowToolExecutions(!showToolExecutions)}
              style={{
                padding: '5px 12px', borderRadius: '20px', border: '1px solid var(--border)',
                background: showToolExecutions ? 'var(--accent)' : 'var(--bg-input)',
                color: showToolExecutions ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {hasRunningTools && (
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%', background: '#007aff',
                  animation: 'pulse 1.5s infinite',
                }} />
              )}
              {completedTools}/{toolExecutions.length} tools
            </button>
          )}
          <button onClick={onToggleFiles} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}>
            {showFiles ? '📂' : '📁'}
          </button>
        </div>
      </div>

      {/* Todo panel (floating) */}
      {showTodos && todos.length > 0 && (
        <TodoPanel todos={todos} onClose={() => setShowTodos(false)} />
      )}

      {/* Tool execution panel (floating) */}
      {showToolExecutions && toolExecutions.length > 0 && (
        <ToolExecutionPanel toolExecutions={toolExecutions} onClose={() => setShowToolExecutions(false)} />
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {messages.filter(msg => msg.type !== 'TASK_STATUS_UPDATE').map(msg => {
          const isUser = msg.sender_id === 'User';
          const { content, reasoning } = formatMessageContent(msg.payload);
          const senderAgent = agents.find(a => a.id === msg.sender_id);

          return (
            <div key={msg.id} style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexDirection: isUser ? 'row-reverse' : 'row' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                {isUser ? '👤' : msg.sender_id === 'Team' ? '👥' : senderAgent?.avatar || '🤖'}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {isUser ? 'You' : msg.sender_id === 'Team' ? selectedTeam?.name : senderAgent?.name || msg.sender_id}
                  {msg.payload?.is_partial && <span style={{ marginLeft: '6px', opacity: 0.6 }}>●●●</span>}
                </div>
                <div style={{
                  fontSize: '14px', lineHeight: '1.6', color: isUser ? '#fff' : 'var(--text-primary)',
                  background: isUser ? 'var(--accent)' : 'var(--bg-input)',
                  padding: '12px 16px', borderRadius: '16px',
                  borderTopRightRadius: isUser ? '4px' : '16px',
                  borderTopLeftRadius: isUser ? '16px' : '4px',
                  border: isUser ? 'none' : '1px solid var(--border)',
                  maxWidth: '80%', whiteSpace: 'pre-wrap',
                }}>
                  {reasoning && (
                    <blockquote style={{ margin: '0 0 12px 0', padding: '12px', borderLeft: '4px solid var(--accent)', background: 'rgba(0,0,0,0.08)', fontStyle: 'italic', fontSize: '13px', color: isUser ? '#eee' : 'var(--text-secondary)', borderRadius: '4px' }}>
                      {reasoning}
                    </blockquote>
                  )}
                  {content}
                </div>
              </div>
            </div>
          );
        })}

        {/* SSE-based thinking indicators — shown when stream is connecting but hasn't received chunks yet */}
        {(streamStatus === 'connecting' || (streamStatus === 'streaming' && !messages.some(m => m.payload?.is_partial))) && (
          <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
              {selectedTeam ? '👥' : selectedAgent?.avatar || '🤖'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                {selectedTeam ? selectedTeam.name : selectedAgent?.name || 'Agent'}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', background: 'var(--bg-input)', padding: '12px 16px', borderRadius: '16px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-flex', gap: '4px' }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-secondary)', animation: `blink 1.2s ${i * 0.2}s infinite` }} />
                  ))}
                </span>
                {streamStatus === 'connecting' ? 'Connecting...' : 'Thinking...'}
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '24px' }}>
        <div style={{ background: 'var(--bg-input)', borderRadius: '16px', border: '1px solid var(--border)', padding: '12px', opacity: isOrchestrating ? 0.6 : 1 }}>
          <textarea
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
            placeholder={isOrchestrating ? 'Team is working...' : 'Message... (Enter to send, Shift+Enter for newline)'}
            disabled={isOrchestrating}
            style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', resize: 'none', minHeight: '60px', fontFamily: 'inherit', fontSize: '14px' }}
          />
          <div style={{ textAlign: 'right' }}>
            <button
              onClick={sendMessage}
              disabled={isOrchestrating}
              style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '16px' }}
            >↑</button>
          </div>
        </div>
      </div>

      {showManageModal && selectedTeam && (
        <TeamManagementModal team={selectedTeam} onClose={() => { setShowManageModal(false); fetchData(); }} />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default TeamChat;
