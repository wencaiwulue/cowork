import React, { useState, useEffect, useRef } from 'react';
import { getBackendUrl } from '../utils/config';
import AgentWizard from './AgentWizard';
import MemoryView from './MemoryView';

interface Agent {
  id: string;
  name: string;
  description: string;
  avatar: string;
  vibe: string;
  skills: string[];
  tools: string[];
}

interface AgentLibraryProps {
  onChat?: (agentId: string) => void;
  onCreateTeam?: (agentId: string) => void;
}

const AgentLibrary: React.FC<AgentLibraryProps> = ({ onChat, onCreateTeam }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [showingMemoryAgent, setShowingMemoryAgent] = useState<Agent | null>(null);
  const [coreFiles, setCoreFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState('');
  const [activeTab, setActiveTab] = useState('Profile');
  const [installedSkills, setInstalledSkills] = useState<{id: string, name: string, description?: string}[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  
  const backendUrl = getBackendUrl();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAgents();
    fetch(`${backendUrl}/skills`).then(res => res.json()).then(setInstalledSkills).catch(() => {});
  }, [showWizard]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await fetch(`${backendUrl}/agents`);
      if (response.ok) setAgents(await response.json());
    } catch (err) { console.error(err); }
  };

  const loadCoreFiles = async (id: string) => {
    setLoadingFiles(true);
    try {
      const response = await fetch(`${backendUrl}/agents/${id}/core_files`);
      if (response.ok) {
        const files = await response.json();
        setCoreFiles(files);
        const fileNames = Object.keys(files).sort();
        if (fileNames.length > 0) {
          if (!activeFile || !files[activeFile]) {
            setActiveFile(fileNames[0]);
          }
        }
      }
    } catch (err) { console.error(err); }
    finally { setLoadingFiles(false); }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!window.confirm('Delete this agent?')) return;
    try {
      const response = await fetch(`${backendUrl}/agents/${id}`, { method: 'DELETE' });
      if (response.ok) { fetchAgents(); setOpenMenuId(null); }
    } catch (err) { console.error(err); }
  };

  const handleSaveAgent = async () => {
    if (!viewingAgent) return;
    try {
      const response = await fetch(`${backendUrl}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(viewingAgent)
      });
      if (response.ok) {
        alert('Agent saved successfully!');
        fetchAgents();
      }
    } catch (err) { console.error(err); }
  };

  const handleSaveCoreFile = async () => {
    if (!viewingAgent || !activeFile) return;
    try {
      const response = await fetch(`${backendUrl}/agents/${viewingAgent.id}/core_files/${activeFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: coreFiles[activeFile] })
      });
      if (response.ok) {
        alert(`${activeFile} saved successfully!`);
      }
    } catch (err) { console.error(err); }
  };

  const filteredAgents = agents.filter(a => 
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (showingMemoryAgent) {
    return <MemoryView agentId={showingMemoryAgent.id} agentName={showingMemoryAgent.name} onBack={() => setShowingMemoryAgent(null)} />;
  }

  if (viewingAgent) {
    return (
      <div style={{ padding: '0', color: 'var(--text-primary)', background: 'var(--bg-primary)', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', border: '1px solid var(--border)' }}>{viewingAgent.avatar}</div>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px' }}>{viewingAgent.name}</h2>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.6 }}>ID: {viewingAgent.id}</div>
            </div>
          </div>
          <button onClick={() => setViewingAgent(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '24px', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: '220px', padding: '24px 16px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[
              { id: 'Profile', icon: '👤' },
              { id: 'Identity', icon: '🔘' },
              { id: 'Tools', icon: '🛠️' },
              { id: 'Skills', icon: '🧩', count: viewingAgent.skills?.length || 0 },
              { id: 'Core Files', icon: '📄' }
            ].map(tab => (
              <button 
                key={tab.id} 
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'Core Files') loadCoreFiles(viewingAgent.id);
                }}
                style={{ 
                  padding: '10px 16px', borderRadius: '10px', border: 'none', textAlign: 'left',
                  background: activeTab === tab.id ? 'var(--bg-hover)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '12px'
                }}
              >
                <span style={{ fontSize: '16px' }}>{tab.icon}</span>
                <span style={{ flex: 1 }}>{tab.id}</span>
                {tab.count !== undefined && (
                  <span style={{ fontSize: '11px', opacity: 0.6 }}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
            {activeTab === 'Skills' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{viewingAgent.skills?.length || 0} skills</div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻</button>
                    <button style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      📤 Upload Skill
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {viewingAgent.skills?.map(skillName => {
                    const skill = installedSkills.find(s => s.name === skillName);
                    return (
                      <div key={skillName} style={{ 
                        padding: '16px 20px', background: 'var(--bg-input)', borderRadius: '16px', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: '16px'
                      }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(52, 199, 89, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🧩</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: '600', fontSize: '15px' }}>{skillName}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.6 }}>v0.0.1</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{skill?.description || 'No description available.'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{ width: '40px', height: '20px', background: '#34c759', borderRadius: '10px', position: 'relative', cursor: 'pointer' }}>
                            <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }} />
                          </div>
                          <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'Core Files' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
                <div style={{ display: 'flex', gap: '24px', flex: 1 }}>
                  <div style={{ width: '200px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Object.keys(coreFiles).sort().map(file => (
                      <button 
                        key={file} 
                        onClick={() => setActiveFile(file)} 
                        style={{
                          padding: '12px', borderRadius: '12px', 
                          border: activeFile === file ? '1px solid var(--accent)' : '1px solid transparent', 
                          textAlign: 'left', 
                          background: activeFile === file ? 'rgba(0, 122, 255, 0.1)' : 'transparent',
                          color: activeFile === file ? 'var(--accent)' : 'var(--text-primary)', 
                          display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                          fontWeight: activeFile === file ? 'bold' : 'normal'
                        }}
                      >
                        <span style={{ opacity: activeFile === file ? 1 : 0.5 }}>📄</span> {file}
                      </button>
                    ))}
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    {loadingFiles ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', color: 'var(--text-secondary)' }}>Loading contents...</div>
                    ) : (
                      <textarea 
                        key={activeFile}
                        value={coreFiles[activeFile] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCoreFiles(prev => ({ ...prev, [activeFile]: val }));
                        }}
                        style={{ 
                          width: '100%', height: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
                          borderRadius: '16px', padding: '20px', color: 'var(--text-primary)', fontFamily: 'monospace',
                          fontSize: '13px', lineHeight: '1.6', resize: 'none', minHeight: '400px'
                        }} 
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'Profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <h3 style={{ fontSize: '24px', marginBottom: '16px' }}>Agent Profile</h3>
                <div style={{ 
                  background: 'var(--bg-input)', padding: '32px', borderRadius: '24px', 
                  border: '1px solid var(--border)', lineHeight: '1.8', fontSize: '15px', color: 'var(--text-primary)',
                  boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.05)', whiteSpace: 'pre-wrap'
                }}>
                  {viewingAgent.description || "No description provided."}
                </div>
              </div>
            )}

            {activeTab === 'Identity' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <h3>Identity Settings</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>NAME</label>
                  <input 
                    value={viewingAgent.name}
                    onChange={(e) => setViewingAgent({...viewingAgent, name: e.target.value})}
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>DESCRIPTION</label>
                  <textarea 
                    value={viewingAgent.description}
                    onChange={(e) => setViewingAgent({...viewingAgent, description: e.target.value})}
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', height: '100px' }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'Tools' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <h3>Tool Permissions</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {['Web Search', 'File Editor', 'Bash Shell', 'Gmail API', 'Python Interpreter'].map(tool => (
                    <label key={tool} style={{ padding: '16px', background: 'var(--bg-input)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input 
                        type="checkbox" 
                        checked={viewingAgent.tools?.includes(tool)}
                        onChange={(e) => {
                          const newTools = e.target.checked 
                            ? [...(viewingAgent.tools || []), tool]
                            : viewingAgent.tools?.filter(t => t !== tool);
                          setViewingAgent({...viewingAgent, tools: newTools || []});
                        }}
                      />
                      {tool}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={activeTab === 'Core Files' ? handleSaveCoreFile : handleSaveAgent}
            style={{ padding: '10px 32px', background: '#34c759', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </div>
    );
  }

  if (showWizard) {
    return (
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowWizard(false)} style={{ position: 'absolute', top: '0', left: '0', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', zIndex: 10 }}>← Back to Library</button>
        <div style={{ paddingTop: '30px' }}><AgentWizard onSuccess={() => setShowWizard(false)} /></div>
      </div>
    );
  }

  const menuItemStyle = {
    width: '100%', padding: '12px 16px', background: 'transparent', border: 'none',
    color: 'var(--text-primary)', textAlign: 'left' as const, cursor: 'pointer', fontSize: '14px',
    display: 'flex', alignItems: 'center', gap: '8px'
  };

  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)', background: 'var(--bg-primary)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>Agents</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: 'var(--bg-input)', borderRadius: '20px', padding: '4px 12px', display: 'flex', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-primary)' }}>My Agents <span style={{ opacity: 0.6 }}>{agents.length}</span></span>
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
            <input type="text" placeholder="Search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: '12px', padding: '8px 12px 8px 32px', color: 'var(--text-primary)', width: '200px', fontSize: '13px' }} />
          </div>
        </div>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '40px' }}>Manage personified assistants and start conversations.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
        <div onClick={() => setShowWizard(true)} style={{ height: '280px', border: '2px dashed var(--border)', borderRadius: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s', color: 'var(--text-secondary)' }} onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--text-secondary)')} onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', marginBottom: '16px', color: 'var(--text-primary)' }}>+</div>
          <span style={{ fontWeight: '500' }}>New Agent</span>
        </div>

        {filteredAgents.map(agent => (
          <div key={agent.id} onClick={() => { setViewingAgent(agent); loadCoreFiles(agent.id); }} style={{ background: 'var(--bg-sidebar)', borderRadius: '24px', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid var(--border)', height: '280px', position: 'relative', cursor: 'pointer' }}>
            <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
              <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === agent.id ? null : agent.id); }} style={{ background: 'var(--bg-input)', border: 'none', color: 'var(--text-primary)', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>•••</button>
              {openMenuId === agent.id && (
                <div ref={menuRef} style={{ position: 'absolute', top: '40px', right: '0', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '12px', width: '140px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', zIndex: 20, overflow: 'hidden' }}>
                  <button onClick={(e) => { e.stopPropagation(); setShowingMemoryAgent(agent); setOpenMenuId(null); }} style={menuItemStyle} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><span>🧠</span> Memory</button>
                  <button onClick={(e) => { e.stopPropagation(); setViewingAgent(agent); loadCoreFiles(agent.id); setOpenMenuId(null); }} style={menuItemStyle} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><span>⚙️</span> Manage</button>
                  <div style={{ height: '1px', background: 'var(--border)' }} />
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteAgent(agent.id); }} style={{ ...menuItemStyle, color: '#ff453a' }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><span>🗑️</span> Delete</button>
                </div>
              )}
            </div>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', marginBottom: '16px' }}>{agent.avatar}</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{agent.name}</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', margin: '0 0 20px 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{agent.description}</p>
            <button onClick={(e) => { e.stopPropagation(); onChat?.(agent.id); }} style={{ width: '100%', padding: '10px', borderRadius: '12px', background: 'rgba(52, 199, 89, 0.15)', color: '#34c759', border: 'none', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span>+</span> Chat</button>
            <button onClick={(e) => { e.stopPropagation(); onCreateTeam?.(agent.id); }} style={{ width: '100%', padding: '8px', borderRadius: '12px', background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontWeight: '500', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><span>👥</span> Create Team</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AgentLibrary;
