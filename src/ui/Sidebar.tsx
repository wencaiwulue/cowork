import React, { useState, useEffect, useRef } from 'react';
import { getBackendUrl } from '../utils/config';

interface Team {
  name: string;
  agents: string[];
}

interface Agent {
  id: string;
  name: string;
}

interface Conversation {
  id: string;
  name: string;
  type: 'agent' | 'team';
  target_id: string;
}

type ViewType = 'agents' | 'team' | 'chat' | 'skills' | 'schedules' | 'connectors' | 'channels' | 'pairings' | 'settings' | 'create-team' | 'new-session' | 'langchain';

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  selectedTeamName?: string;
  onTeamChange: (teamName: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange, selectedTeamName, onTeamChange }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [expanded, setExpanded] = useState({
    capabilities: true,
    messages: true,
    teams: true
  });

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingTeamName, setRenamingTeamName] = useState<string | null>(null);
  const [renameTeamValue, setRenameTeamValue] = useState('');

  const backendUrl = getBackendUrl();

  useEffect(() => {
    // Listen for backend-ready event from main process
    const handleBackendReady = () => {
      console.log("[Sidebar] Backend ready, fetching initial data...");
      fetchData();
    };

    // @ts-ignore - electron API
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.on('backend-ready', handleBackendReady);
    }

    // Also try to fetch data immediately (for web/browser mode)
    fetchData();

    const interval = setInterval(fetchData, 5000);

    const handleRefresh = () => {
      console.log("Sidebar refresh triggered");
      fetchData();
    };
    window.addEventListener('session-created', handleRefresh);
    window.addEventListener('refresh-sidebar', handleRefresh);

    return () => {
      clearInterval(interval);
      window.removeEventListener('session-created', handleRefresh);
      window.removeEventListener('refresh-sidebar', handleRefresh);
      // @ts-ignore - electron API
      if (window.require) {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.removeListener('backend-ready', handleBackendReady);
      }
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      console.log("Sidebar: Fetching teams, agents, sessions...");
      const [tRes, aRes, sRes] = await Promise.all([
        fetch(`${backendUrl}/teams`),
        fetch(`${backendUrl}/agents`),
        fetch(`${backendUrl}/sessions`)
      ]);
      if (tRes.ok) setTeams(await tRes.json());
      if (aRes.ok) setAgents(await aRes.json());
      if (sRes.ok) setConversations(await sRes.json());
    } catch (err) {
      console.error("Sidebar: Fetch data failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewMessage = () => {
    console.log("Sidebar: handleNewMessage clicked");
    onViewChange('new-session');
  };

  const handleRenameSession = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      const original = conversations.find(c => c.id === id);
      if (!original) return;
      const res = await fetch(`${backendUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...original, name: renameValue })
      });
      if (res.ok) {
        setRenamingSessionId(null);
        fetchData();
      }
    } catch (err) { console.error(err); }
  };

  const handleRenameTeam = async (oldName: string) => {
    if (!renameTeamValue.trim() || renameTeamValue === oldName) return;
    try {
      const res = await fetch(`${backendUrl}/teams/${encodeURIComponent(oldName)}/rename?new_name=${encodeURIComponent(renameTeamValue)}`, {
        method: 'PUT'
      });
      if (res.ok) {
        setRenamingTeamName(null);
        fetchData();
      }
    } catch (err) { console.error(err); }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation?")) return;
    try {
      const res = await fetch(`${backendUrl}/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    } catch (err) { console.error(err); }
  };

  const navItemStyle = (active: boolean) => ({
    padding: '8px 12px',
    cursor: 'pointer',
    background: active ? 'rgba(0, 122, 255, 0.15)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-primary)',
    borderRadius: '8px',
    marginBottom: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    fontWeight: active ? '600' : '400',
    border: 'none',
    width: '100%',
    textAlign: 'left' as const,
    transition: 'all 0.2s',
    position: 'relative' as 'relative'
  });

  const sectionHeaderStyle = {
    color: 'var(--text-secondary)',
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase' as const,
    padding: '16px 12px 8px',
    letterSpacing: '0.05em',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer'
  };

  return (
    <div style={{
      width: '240px',
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{ padding: '24px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src="/logo.svg" style={{ width: '32px', height: '32px', borderRadius: '10px' }} />
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)' }}>CoWork</div>
      </div>
      
      <button 
        onClick={handleNewMessage}
        style={{
          margin: '0 16px 16px',
          padding: '10px',
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          color: 'var(--text-primary)',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
      >
        <span>+</span> New Message
      </button>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        <button 
          onClick={() => onViewChange('agents')} 
          style={navItemStyle(currentView === 'agents')}
        >
          <span style={{ opacity: 0.7 }}>👤</span> Agents
        </button>

        {/* Capabilities Section */}
        <div style={sectionHeaderStyle} onClick={() => setExpanded({...expanded, capabilities: !expanded.capabilities})}>
          <span>Capabilities {expanded.capabilities ? '▼' : '▶'}</span>
        </div>
        {expanded.capabilities && (
          <div>
            <button onClick={() => onViewChange('schedules')} style={navItemStyle(currentView === 'schedules')}>
              <span style={{ opacity: 0.7 }}>⏰</span> Scheduled Tasks
            </button>
            <button onClick={() => onViewChange('connectors')} style={navItemStyle(currentView === 'connectors')}>
              <span style={{ opacity: 0.7 }}>🔗</span> Connectors
            </button>
            <button onClick={() => onViewChange('skills')} style={navItemStyle(currentView === 'skills')}>
              <span style={{ opacity: 0.7 }}>🧩</span> Skills
            </button>
            <button onClick={() => onViewChange('langchain')} style={navItemStyle(currentView === 'langchain')}>
              <span style={{ opacity: 0.7 }}>🦜</span> LangChain
            </button>
          </div>
        )}

        {/* Messages Section */}
        <div style={sectionHeaderStyle} onClick={() => setExpanded({...expanded, messages: !expanded.messages})}>
          <span>Messages {expanded.messages ? '▼' : '▶'}</span>
        </div>
        {expanded.messages && (
          <div>
            {conversations.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>No active messages</div>
            )}
            {conversations.map(c => (
              <div key={c.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                {renamingSessionId === c.id ? (
                  <input 
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => handleRenameSession(c.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRenameSession(c.id)}
                    autoFocus
                    style={{ 
                      width: '100%', padding: '6px 8px', borderRadius: '4px', 
                      background: 'var(--bg-input)', color: 'var(--text-primary)', 
                      border: '1px solid var(--accent)', margin: '2px 0'
                    }}
                  />
                ) : (
                  <button 
                    onClick={() => { onTeamChange(c.id); onViewChange('chat'); }} 
                    style={navItemStyle(currentView === 'chat' && selectedTeamName === c.id)}
                  >
                    <span style={{ opacity: 0.7 }}>💬</span> 
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <div style={{ display: 'flex', gap: '4px' }} className="sidebar-item-actions">
                      <span 
                        onClick={(e) => { e.stopPropagation(); setRenamingSessionId(c.id); setRenameValue(c.name); }}
                        style={{ opacity: 0.5, fontSize: '12px', cursor: 'pointer' }}
                      >✏️</span>
                      <span 
                        onClick={(e) => deleteConversation(c.id, e)}
                        style={{ opacity: 0.5, fontSize: '16px', cursor: 'pointer' }}
                      >×</span>
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Teams Section */}
        <div style={{ ...sectionHeaderStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setExpanded({...expanded, teams: !expanded.teams})}>
          <span 
            onClick={(e) => { e.stopPropagation(); onViewChange('team'); }}
            style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            Teams {expanded.teams ? '▼' : '▶'} <span style={{ fontSize: '9px', opacity: 0.6, background: 'var(--bg-input)', padding: '1px 4px', borderRadius: '4px' }}>Beta</span>
          </span>
          <button 
            onClick={(e) => { e.stopPropagation(); onViewChange('create-team'); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}
          >
            +
          </button>
        </div>
        {expanded.teams && (
          <div>
            {teams.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>No teams found</div>
            )}
            {teams.map(t => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center' }}>
                {renamingTeamName === t.name ? (
                  <input 
                    value={renameTeamValue}
                    onChange={(e) => setRenameTeamValue(e.target.value)}
                    onBlur={() => handleRenameTeam(t.name)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRenameTeam(t.name)}
                    autoFocus
                    style={{ 
                      width: '100%', padding: '6px 8px', borderRadius: '4px', 
                      background: 'var(--bg-input)', color: 'var(--text-primary)', 
                      border: '1px solid var(--accent)', margin: '2px 0'
                    }}
                  />
                ) : (
                  <button 
                    onClick={() => { onTeamChange(t.name); onViewChange('chat'); }}
                    style={navItemStyle(currentView === 'chat' && selectedTeamName === t.name)}
                  >
                    <span style={{ opacity: 0.7 }}>👥</span> 
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <div style={{ display: 'flex', gap: '4px' }} className="sidebar-item-actions">
                      <span 
                        onClick={(e) => { e.stopPropagation(); setRenamingTeamName(t.name); setRenameTeamValue(t.name); }}
                        style={{ opacity: 0.5, fontSize: '12px', cursor: 'pointer' }}
                      >✏️</span>
                      <span 
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete team "${t.name}"?`)) {
                            await fetch(`${backendUrl}/teams/${encodeURIComponent(t.name)}`, { method: 'DELETE' });
                            fetchData();
                          }
                        }}
                        style={{ opacity: 0.5, fontSize: '16px', cursor: 'pointer' }}
                      >×</span>
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div 
        onClick={() => onViewChange('settings')}
        style={{
          padding: '16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          cursor: 'pointer',
          background: currentView === 'settings' ? 'var(--bg-hover)' : 'transparent',
        }}
      >
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#34c759', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>N</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' }}>naison</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Settings</div>
        </div>
        <div style={{ fontSize: '12px', opacity: 0.5, color: 'var(--text-primary)' }}>⚙️</div>
      </div>
    </div>
  );
};

export default Sidebar;
