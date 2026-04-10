import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface AgentRecord {
  id: string;
  name: string;
  avatar: string;
  isTL: boolean;
}

const TeamManagement: React.FC = () => {
  const backendUrl = getBackendUrl();
  const [teamName, setTeamName] = useState('My Dev Team');
  const [selectedAgents, setSelectedAgents] = useState<AgentRecord[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentRecord[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await fetch(`${backendUrl}/agents`);
      if (response.ok) {
        const data = await response.json();
        setAvailableAgents(data.map((a: any) => ({
          id: a.id,
          name: a.name,
          avatar: a.avatar || '🤖',
          isTL: false
        })));
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    }
  };

  const toggleTL = (id: string) => {
    setSelectedAgents(prev => prev.map(agent => ({
      ...agent,
      isTL: agent.id === id ? !agent.isTL : false // Only one TL allowed for simplicity
    })));
  };

  const removeAgent = (id: string) => {
    setSelectedAgents(prev => prev.filter(agent => agent.id !== id));
  };

  const addAgent = (agent: AgentRecord) => {
    if (!selectedAgents.find(a => a.id === agent.id)) {
      setSelectedAgents([...selectedAgents, agent]);
    }
    setShowLibrary(false);
  };

  const activateTeam = async () => {
    if (selectedAgents.length === 0) {
      alert('Please add at least one agent to the team.');
      return;
    }
    const tl = selectedAgents.find(a => a.isTL);
    if (!tl) {
      alert('Please set a Team Lead (TL).');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: teamName,
          agents: selectedAgents.map(a => a.id),
          tl_id: tl.id
        })
      });
      if (response.ok) {
        alert(`Team "${teamName}" activated successfully!`);
      } else {
        alert('Failed to activate team.');
      }
    } catch (err) {
      console.error('API Error:', err);
      alert('Could not reach backend.');
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', color: 'var(--text-primary)' }}>
      <h2 style={{ marginBottom: '24px' }}>Team Management</h2>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Team Settings */}
        <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Team Name</label>
          <input 
            value={teamName} 
            onChange={(e) => setTeamName(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '8px', 
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '18px',
              fontWeight: 'bold'
            }}
          />
        </div>

        {/* Selected Agents List */}
        <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>Team Members ({selectedAgents.length}/10)</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {selectedAgents.map(agent => (
              <div key={agent.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '12px',
                borderRadius: '8px',
                background: 'var(--bg-primary)',
                border: agent.isTL ? '1px solid var(--accent)' : '1px solid var(--border)'
              }}>
                <div style={{ fontSize: '24px' }}>{agent.avatar}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold' }}>{agent.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ID: {agent.id}</div>
                </div>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => toggleTL(agent.id)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '4px',
                      background: agent.isTL ? 'var(--accent)' : 'transparent',
                      color: agent.isTL ? '#fff' : 'var(--accent)',
                      border: '1px solid var(--accent)',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {agent.isTL ? 'Team Lead' : 'Set TL'}
                  </button>
                  <button 
                    onClick={() => removeAgent(agent.id)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: '#ff3b30',
                      border: '1px solid #ff3b30',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button 
            onClick={() => setShowLibrary(!showLibrary)}
            style={{
              marginTop: '24px',
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px dashed var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            {showLibrary ? 'Close Library' : '+ Add Agent from Library'}
          </button>

          {showLibrary && (
            <div style={{ marginTop: '16px', background: 'var(--bg-hover)', padding: '16px', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 12px 0' }}>Available Agents</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {availableAgents.filter(a => !selectedAgents.find(s => s.id === a.id)).map(agent => (
                  <div key={agent.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px',
                    background: 'var(--bg-primary)',
                    borderRadius: '4px',
                    border: '1px solid var(--border)'
                  }}>
                    <span>{agent.avatar}</span>
                    <span style={{ flex: 1 }}>{agent.name}</span>
                    <button 
                      onClick={() => addAgent(agent)}
                      style={{ padding: '4px 8px', borderRadius: '4px', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={activateTeam}
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '16px'
          }}
        >
          Activate Team
        </button>
      </div>
    </div>
  );
};

export default TeamManagement;
