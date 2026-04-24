import React, { useState, useEffect, useRef } from 'react';
import { getBackendUrl } from '../utils/config';
import { MessageBus } from '../core/MessageBus';
import { AgentMessage } from '../types/agent';
import { startAgentStream } from './TeamChat';

interface Agent {
  id: string;
  name: string;
  avatar: string;
  description: string;
  vibe?: string;
}

interface NewSessionProps {
  onSessionCreated?: (sessionId: string) => void;
  onCancel?: () => void;
}

const NewSession: React.FC<NewSessionProps> = ({ onSessionCreated, onCancel }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);

  const backendUrl = getBackendUrl();
  const bus = MessageBus.getInstance();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchAgents();
    // Focus input on mount
    inputRef.current?.focus();

    // Listen for pre-selected agent from AgentLibrary
    const handlePreselectAgent = (e: CustomEvent) => {
      const agentId = e.detail;
      const agent = agents.find(a => a.id === agentId);
      if (agent) {
        setSelectedAgent(agent);
      }
    };
    window.addEventListener('preselect-agent', handlePreselectAgent as EventListener);
    return () => window.removeEventListener('preselect-agent', handlePreselectAgent as EventListener);
  }, [agents]);

  const fetchAgents = async () => {
    try {
      const res = await fetch(`${backendUrl}/agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
        // Select first agent by default
        if (data.length > 0 && !selectedAgent) {
          setSelectedAgent(data[0]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch agents:', e);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedAgent || isLoading) return;

    setIsLoading(true);

    try {
      // Create session
      const name = inputValue.slice(0, 30) + (inputValue.length > 30 ? '...' : '');
      const res = await fetch(`${backendUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          target_id: selectedAgent.id,
          target_type: 'agent'
        }),
      });

      if (res.ok) {
        const session = await res.json();

        // Start agent stream to receive response
        // The stream will handle the message sending and response processing
        const history: Array<{role: 'user' | 'assistant'; content: string}> = [];

        // Wait for stream to complete before notifying parent
        // This ensures the agent's response has been saved to the backend
        // before TeamChat tries to load messages
        startAgentStream(session.id, selectedAgent.id, inputValue, history, backendUrl, () => {
          // Stream completed - now notify parent
          console.log('[NewSession] Stream completed, notifying parent');
          onSessionCreated?.(session.id);
          window.dispatchEvent(new CustomEvent('session-created', { detail: session.id }));
          setIsLoading(false);
        });
      }
    } catch (e) {
      console.error('Failed to create session:', e);
      setIsLoading(false);
    }
    // Note: isLoading is set to false in the stream completion callback
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-primary)',
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      {/* Close button */}
      {onCancel && (
        <button
          onClick={onCancel}
          style={{
            position: 'absolute',
            top: '24px',
            left: '24px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '24px',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ←
        </button>
      )}

      {/* Main content */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: '600px',
        width: '100%',
      }}>
        {/* Agent Avatar */}
        <div
          onClick={() => setShowAgentSelector(!showAgentSelector)}
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: selectedAgent ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'var(--bg-input)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '40px',
            cursor: 'pointer',
            marginBottom: '24px',
            border: '3px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            transition: 'all 0.2s',
          }}
        >
          {selectedAgent?.avatar || '🤖'}
        </div>

        {/* Agent Selector Dropdown */}
        {showAgentSelector && (
          <div style={{
            position: 'absolute',
            top: '140px',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '12px',
            minWidth: '280px',
            maxHeight: '300px',
            overflowY: 'auto',
            zIndex: 100,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 'bold',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              padding: '8px 12px',
              letterSpacing: '0.05em',
            }}>
              Select an agent
            </div>
            {agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => {
                  setSelectedAgent(agent);
                  setShowAgentSelector(false);
                }}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: selectedAgent?.id === agent.id ? 'var(--bg-hover)' : 'transparent',
                }}
              >
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  {agent.avatar}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                  }}>
                    {agent.name}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '150px',
                  }}>
                    {agent.description}
                  </div>
                </div>
                {selectedAgent?.id === agent.id && (
                  <span style={{ color: '#34c759', fontSize: '18px' }}>✓</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Agent Name */}
        <div style={{
          fontSize: '28px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
        }} onClick={() => setShowAgentSelector(!showAgentSelector)}>
          {selectedAgent?.name || 'Select an agent'}
          <span style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            transform: showAgentSelector ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>▼</span>
        </div>

        {/* Agent Description */}
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginBottom: '48px',
          maxWidth: '400px',
          lineHeight: '1.5',
        }}>
          {selectedAgent?.description || 'Choose an agent to start a conversation'}
        </div>

        {/* Input Area */}
        <div style={{
          width: '100%',
          background: 'var(--bg-input)',
          borderRadius: '24px',
          border: '1px solid var(--border)',
          padding: '16px 20px',
        }}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (@ to reference files)"
            disabled={isLoading || !selectedAgent}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              outline: 'none',
              resize: 'none',
              minHeight: '60px',
              fontFamily: 'inherit',
              fontSize: '15px',
              lineHeight: '1.5',
            }}
          />

          {/* Input Toolbar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border)',
          }}>
            {/* Left side */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '20px',
                  padding: '4px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Add context"
              >
                +
              </button>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>📁</span>
                <span>project</span>
              </button>
            </div>

            {/* Right side */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>✓</span>
                <span>Full Access</span>
                <span>▼</span>
              </button>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>⚙️</span>
                <span>Auto</span>
                <span>▼</span>
              </button>
              <button
                onClick={handleSend}
                disabled={isLoading || !inputValue.trim() || !selectedAgent}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: isLoading || !inputValue.trim() || !selectedAgent
                    ? 'var(--bg-hover)'
                    : 'var(--accent)',
                  color: isLoading || !inputValue.trim() || !selectedAgent
                    ? 'var(--text-secondary)'
                    : '#fff',
                  border: 'none',
                  cursor: isLoading || !inputValue.trim() || !selectedAgent ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  transition: 'all 0.2s',
                }}
              >
                {isLoading ? '⏳' : '↑'}
              </button>
            </div>
          </div>
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div style={{
            marginTop: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--text-secondary)',
            fontSize: '14px',
          }}>
            <span style={{
              width: '16px',
              height: '16px',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            Creating conversation...
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default NewSession;
