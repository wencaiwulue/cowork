import React, { useState, useEffect, useRef } from 'react';
import { getBackendUrl } from '../utils/config';
import { MessageBus } from '../core/MessageBus';
import { AgentMessage } from '../types/agent';
import TeamManagementModal from './TeamManagementModal';

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

interface TeamChatProps {
  selectedTeamName: string; 
  showFiles: boolean;
  onToggleFiles: () => void;
}

const TeamChat: React.FC<TeamChatProps> = ({ selectedTeamName, showFiles, onToggleFiles }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [mentionSuggestions, setMentionSuggestions] = useState<Agent[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showMembersPopover, setShowMembersPopover] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  
  const currentIdRef = useRef(selectedTeamName);
  useEffect(() => { currentIdRef.current = selectedTeamName; }, [selectedTeamName]);

  const backendUrl = getBackendUrl();
  const bus = MessageBus.getInstance();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find(s => s.id === selectedTeamName) || null;
  const selectedTeam = currentSession?.target_type === 'team' 
    ? teams.find(t => t.name === currentSession.target_id) 
    : teams.find(t => t.name === selectedTeamName) || null;
  
  const selectedAgent = currentSession?.target_type === 'agent'
    ? agents.find(a => a.id === currentSession.target_id)
    : (!selectedTeam ? agents.find(a => a.id === selectedTeamName) : null) || (selectedTeamName.startsWith('new-draft-') && agents.length > 0 ? agents[0] : null);

  const teamAgents = selectedTeam ? agents.filter(a => selectedTeam.agents.includes(a.id)) : (selectedAgent ? [selectedAgent] : []);

  const fetchData = async () => {
    try {
      const [tRes, aRes, sRes] = await Promise.all([
        fetch(`${backendUrl}/teams`),
        fetch(`${backendUrl}/agents`),
        fetch(`${backendUrl}/sessions`)
      ]);
      if (tRes.ok) setTeams(await tRes.json());
      if (aRes.ok) setAgents(await aRes.json());
      if (sRes.ok) setSessions(await sRes.json());
    } catch (err) {}
  };

  useEffect(() => {
    fetchData();
    if (selectedTeamName && !selectedTeamName.startsWith('new-draft-')) {
      fetch(`${backendUrl}/messages/${encodeURIComponent(selectedTeamName)}`)
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(err => console.error(err));
    } else {
      setMessages([]);
    }
  }, [selectedTeamName]);

  useEffect(() => {
    const handleMessage = async (msg: AgentMessage) => {
      const cid = msg.context_metadata.conversation_id;
      const current = currentIdRef.current;
      
      // Allow messages for the current session OR the draft that just started it
      const isMatch = cid === current || (current.startsWith('new-draft-') && msg.sender_id === 'User');
      
      if (!isMatch) return;
      
      setMessages(prev => {
        if (msg.type === 'TASK_STATUS_UPDATE') {
          return [...prev.filter(m => !(m.type === 'TASK_STATUS_UPDATE' && m.payload.task_id === msg.payload.task_id)), msg];
        }
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      
      if (msg.type !== 'HEARTBEAT' && !msg.payload?.is_partial) {
        fetch(`${backendUrl}/messages/${encodeURIComponent(cid)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg)
        }).catch(err => console.error(err));
      }

      // Execute Agent Task (Single Agent)
      if (msg.type === 'TASK_ASSIGN' && msg.receiver_id !== 'ALL' && msg.receiver_id !== 'User' && msg.receiver_id !== 'TEAM_PLAN') {
        const receiverAgent = agents.find(a => a.id === msg.receiver_id);
        if (!receiverAgent) return;

        const replyId = `reply-${Date.now()}`;
        bus.publish({
          id: `status-${Date.now()}`, sender_id: msg.receiver_id, receiver_id: 'User', type: 'TASK_STATUS_UPDATE',
          payload: { task_id: msg.payload.task_id, status: 'in_progress', content: `${receiverAgent.name} is thinking...` },
          context_metadata: { conversation_id: cid }
        });

        try {
          const response = await fetch(`${backendUrl}/agents/${msg.receiver_id}/run_stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: msg.payload.content,
              history: messages.slice(-10).map(m => ({ role: m.sender_id === 'User' ? 'user' : 'assistant', content: m.payload.content || (typeof m.payload === 'string' ? m.payload : '') }))
            })
          });

          if (!response.body) return;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let content = ''; let reasoning = '';
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6);
                if (dataStr === '[DONE]') continue;
                try {
                  const data = JSON.parse(dataStr);
                  content += data.content || '';
                  reasoning += data.reasoning || '';
                  setMessages(prev => {
                    const newMsg: AgentMessage = { id: replyId, sender_id: msg.receiver_id, receiver_id: 'User', type: 'FEEDBACK', payload: { content, reasoning, is_partial: true }, context_metadata: { conversation_id: cid } };
                    const existing = prev.find(m => m.id === replyId);
                    const filtered = prev.filter(m => !(m.type === 'TASK_STATUS_UPDATE' && m.payload.task_id === msg.payload.task_id));
                    if (existing) return filtered.map(m => m.id === replyId ? newMsg : m);
                    return [...filtered, newMsg];
                  });
                } catch {}
              }
            }
          }
          const finalMsg: AgentMessage = { id: replyId, sender_id: msg.receiver_id, receiver_id: 'User', type: 'FEEDBACK', payload: { content, reasoning }, context_metadata: { conversation_id: cid } };
          setMessages(prev => prev.map(m => m.id === replyId ? finalMsg : m));
          bus.publish(finalMsg);
          bus.publish({ id: `done-${Date.now()}`, sender_id: msg.receiver_id, receiver_id: 'User', type: 'TASK_STATUS_UPDATE', payload: { task_id: msg.payload.task_id, status: 'completed', content: 'Done' }, context_metadata: { conversation_id: cid } });
        } catch (err) { console.error(err); }
      }
    };
    bus.on('message', handleMessage);
    return () => { bus.off('message', handleMessage); };
  }, [agents, teams, selectedTeamName, messages, teamAgents, selectedAgent]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async () => {
    console.log("TeamChat: sendMessage invoked", { inputValue, selectedTeam, selectedAgent, selectedTeamName });
    if (!inputValue.trim() || (!selectedTeam && !selectedAgent)) {
      console.warn("TeamChat: Validation failed, input empty or no target selected");
      return;
    }
    
    let convoId = selectedTeamName;
    if (selectedTeamName.startsWith('new-draft-') && selectedAgent) {
      const name = inputValue.slice(0, 30) + (inputValue.length > 30 ? '...' : '');
      console.log("TeamChat: Creating new session for draft:", name);
      try {
        const res = await fetch(`${backendUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_id: selectedAgent.id, target_type: 'agent' })
        });
        if (res.ok) {
          const s = await res.json();
          convoId = s.id;
          console.log("TeamChat: Session persistence success, ID:", convoId);
          window.dispatchEvent(new CustomEvent('session-created', { detail: convoId }));
        } else {
          console.error("TeamChat: Session persistence failed", res.status);
        }
      } catch (err) {
        console.error("TeamChat: Session creation exception", err);
      }
    }

    console.log("TeamChat: Publishing user message to bus", convoId);
    const userMsg: AgentMessage = { id: `u-${Date.now()}`, sender_id: 'User', receiver_id: 'ALL', type: 'FEEDBACK', payload: { content: inputValue }, context_metadata: { conversation_id: convoId } };
    bus.publish(userMsg);
    
    const mentions = inputValue.match(/@([^\s!?,.:;]+)/g);
    if (mentions) {
      mentions.forEach(m => {
        const name = m.slice(1);
        const agent = agents.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (agent && (selectedTeam?.agents.includes(agent.id) || selectedAgent?.id === agent.id)) {
          bus.publish({
            id: `task-${Date.now()}-${agent.id}`, sender_id: 'User', receiver_id: agent.id, type: 'TASK_ASSIGN',
            payload: { task_id: `task-${Date.now()}`, status: 'pending', content: inputValue.replace(m, '').trim() },
            context_metadata: { conversation_id: convoId }
          });
        }
      });
    } else if (selectedAgent) {
      console.log("TeamChat: 1:1 auto-assigning to", selectedAgent.name);
      bus.publish({ id: `t-${Date.now()}`, sender_id: 'User', receiver_id: selectedAgent.id, type: 'TASK_ASSIGN', payload: { task_id: `task-${Date.now()}`, status: 'pending', content: inputValue.trim() }, context_metadata: { conversation_id: convoId } });
    } else if (selectedTeam) {
      setIsOrchestrating(true);
      const taskId = `team-task-${Date.now()}`;
      bus.publish({ id: `status-${Date.now()}`, sender_id: 'System', receiver_id: 'User', type: 'TASK_STATUS_UPDATE', payload: { task_id: taskId, status: 'in_progress', content: `Executing Team Orchestration Plan...` }, context_metadata: { conversation_id: convoId } });
      
      try {
        const response = await fetch(`${backendUrl}/teams/${encodeURIComponent(selectedTeam.name)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: inputValue.trim(),
            history: messages.slice(-10).map(m => ({ role: m.sender_id === 'User' ? 'user' : 'assistant', content: m.payload.content || (typeof m.payload === 'string' ? m.payload : '') }))
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          bus.publish({
            id: `reply-${Date.now()}`, sender_id: 'Team', receiver_id: 'User', type: 'FEEDBACK',
            payload: { content: data.content }, context_metadata: { conversation_id: convoId }
          });
          bus.publish({ id: `done-${Date.now()}`, sender_id: 'System', receiver_id: 'User', type: 'TASK_STATUS_UPDATE', payload: { task_id: taskId, status: 'completed', content: 'Orchestration Complete' }, context_metadata: { conversation_id: convoId } });
        }
      } catch (err) { console.error(err); }
      finally { setIsOrchestrating(false); }
    }
    setInputValue('');
  };

  const formatMessageContent = (payload: any) => {
    let content = payload.content || (typeof payload === 'string' ? payload : '');
    let reasoning = payload.reasoning || '';
    const m = content.match(/<(think|thought)>([\s\S]*?)<\/\1>/i) || content.match(/<(think|thought)>([\s\S]*)$/i);
    if (m) { reasoning = (reasoning + '\n' + m[2]).trim(); content = content.replace(m[0], '').trim(); }
    return { content, reasoning };
  };

  const headerTitle = selectedTeam ? selectedTeam.name : (selectedAgent ? selectedAgent.name : (selectedTeamName.startsWith('new-draft-') ? 'New Message' : selectedTeamName));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-primary)' }}>
        <div style={{ fontWeight: '600', fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{headerTitle}</span>
          {selectedTeam && (
            <div onClick={() => setShowMembersPopover(!showMembersPopover)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '20px' }}>
              <div style={{ display: 'flex' }}>{teamAgents.slice(0, 4).map((a, i) => (<div key={a.id} style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--bg-hover)', border: '2px solid var(--bg-primary)', marginLeft: i === 0 ? 0 : '-8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', overflow: 'hidden' }}>{a.avatar}</div>))}</div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{teamAgents.length}</span>
            </div>
          )}
        </div>
        <button onClick={onToggleFiles} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>{showFiles ? '📂' : '📁'}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {messages.map(m => {
          const isUser = m.sender_id === 'User';
          const { content, reasoning } = m.type !== 'TASK_STATUS_UPDATE' ? formatMessageContent(m.payload) : { content: '', reasoning: '' };
          return (
            <div key={m.id} style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexDirection: isUser ? 'row-reverse' : 'row' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                {isUser ? '👤' : (m.sender_id === 'Team' ? '👥' : (agents.find(a => a.id === m.sender_id)?.avatar || (m.sender_id === 'System' ? '⚙️' : '🤖')))}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{isUser ? 'User' : (m.sender_id === 'Team' ? selectedTeam?.name : (agents.find(a => a.id === m.sender_id)?.name || m.sender_id))}</div>
                <div style={{ 
                  fontSize: '14px', lineHeight: '1.5', color: isUser ? '#fff' : 'var(--text-primary)', background: isUser ? 'var(--accent)' : 'var(--bg-input)', 
                  padding: '12px 16px', borderRadius: '16px', borderTopRightRadius: isUser ? '4px' : '16px', borderTopLeftRadius: isUser ? '16px' : '4px', border: isUser ? 'none' : '1px solid var(--border)', maxWidth: '80%', whiteSpace: 'pre-wrap' 
                }}>
                  {m.type === 'TASK_STATUS_UPDATE' && <div style={{ color: '#34c759', fontWeight: 'bold' }}>⚙️ {m.payload.content}</div>}
                  {reasoning && <blockquote style={{ margin: '0 0 12px 0', padding: '12px', borderLeft: '4px solid var(--accent)', background: 'rgba(0,0,0,0.1)', fontStyle: 'italic', fontSize: '13px', color: isUser ? '#eee' : 'var(--text-secondary)' }}>{reasoning}</blockquote>}
                  {content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      <div style={{ padding: '24px' }}>
        <div style={{ background: 'var(--bg-input)', borderRadius: '16px', border: '1px solid var(--border)', padding: '12px', opacity: isOrchestrating ? 0.6 : 1 }}>
          <textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())} placeholder={isOrchestrating ? "Team is working..." : "Message team or @member..."} disabled={isOrchestrating} style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', resize: 'none', minHeight: '60px' }} />
          <div style={{ textAlign: 'right' }}><button onClick={sendMessage} disabled={isOrchestrating} style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>↑</button></div>
        </div>
      </div>

      {showManageModal && selectedTeam && (
        <TeamManagementModal team={selectedTeam} onClose={() => { setShowManageModal(false); fetchData(); }} />
      )}
    </div>
  );
};

export default TeamChat;
