import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';
import OrchestrationCanvas from './OrchestrationCanvas';
import { OrchestrationNode } from './OrchestrationDesigner';

interface Agent {
  id: string;
  name: string;
  avatar: string;
  description: string;
}

interface Team {
  name: string;
  agents: string[];
  tl_id?: string;
  orchestration_plan?: OrchestrationNode;
}

interface Props {
  team: Team;
  onClose: () => void;
}

const TeamManagementModal: React.FC<Props> = ({ team, onClose }) => {
  const [step, setStep] = useState(1);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(team.agents);
  const [tlId, setTlId] = useState<string | undefined>(team.tl_id);
  const [teamName, setTeamName] = useState(team.name);
  const [search, setSearch] = useState('');
  
  // Default orchestration plan
  const [orchestration, setOrchestration] = useState<OrchestrationNode>(team.orchestration_plan || {
    mode: 'supervisor',
    agents: team.agents,
    children: []
  });
  
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetch(`${backendUrl}/agents`)
      .then(res => res.json())
      .then(data => setAllAgents(data));
  }, []);

  // Update orchestration agents when selection changes
  useEffect(() => {
    if (step === 1) {
      setOrchestration(prev => ({
        ...prev,
        agents: selectedIds
      }));
    }
  }, [selectedIds, step]);

  const handleConfirm = async () => {
    if (!teamName.trim()) {
      alert("Please enter a team name");
      return;
    }
    try {
      const response = await fetch(`${backendUrl}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: teamName,
          agents: selectedIds,
          tl_id: tlId,
          orchestration_plan: orchestration
        })
      });
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('refresh-sidebar'));
        onClose();
      }
    } catch (err) { console.error(err); }
  };

  const toggleAgent = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
      if (tlId === id) setTlId(undefined);
    } else {
      if (selectedIds.length < 10) {
        setSelectedIds([...selectedIds, id]);
      } else {
        alert("Maximum 10 agents per team");
      }
    }
  };

  const filteredAgents = allAgents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));
  const selectedAgentObjects = allAgents.filter(a => selectedIds.includes(a.id));

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        width: '1000px', height: '850px', background: 'var(--bg-primary)',
        borderRadius: '24px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
      }}>
        {/* Header */}
        <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '28px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
              {step === 1 ? 'Team Members' : 'Orchestration Canvas'}
            </h2>
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
              {step === 1 ? 'Select agents and designate a Team Lead.' : 'Visually design complex multi-agent collaboration flows.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', marginRight: '24px' }}>
              {[1, 2].map(s => (
                <div key={s} style={{ width: '32px', height: '32px', borderRadius: '50%', background: step === s ? 'var(--accent)' : 'var(--bg-input)', color: step === s ? '#fff' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold' }}>{s}</div>
              ))}
            </div>
            <button onClick={onClose} style={{ background: 'var(--bg-input)', border: 'none', color: 'var(--text-secondary)', width: '40px', height: '40px', borderRadius: '50%', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          
          {step === 1 ? (
            <>
              {/* Left Column: All Agents Search */}
              <div style={{ flex: 1, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '32px' }}>
                <div style={{ position: 'relative', marginBottom: '24px' }}>
                  <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                  <input 
                    placeholder="Search agents..." 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ 
                      width: '100%', padding: '14px 14px 14px 48px', borderRadius: '14px', 
                      border: '1px solid var(--border)', background: 'var(--bg-input)', 
                      color: 'var(--text-primary)', fontSize: '15px'
                    }}
                  />
                </div>
                
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
                  ALL AGENTS ({allAgents.length})
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {filteredAgents.map(a => {
                    const isSelected = selectedIds.includes(a.id);
                    return (
                      <div key={a.id} style={{
                        padding: '12px 16px', borderRadius: '16px', background: 'var(--bg-input)', 
                        border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '16px'
                      }}>
                        <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>{a.avatar}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>{a.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>{a.description}</div>
                        </div>
                        <button 
                          onClick={() => toggleAgent(a.id)}
                          style={{
                            width: '36px', height: '36px', borderRadius: '50%', border: 'none',
                            background: isSelected ? 'rgba(52, 199, 89, 0.15)' : 'var(--bg-hover)',
                            color: isSelected ? '#34c759' : 'var(--text-primary)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px'
                          }}
                        >
                          {isSelected ? '✓' : '+'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Selected Members & Team Settings */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '32px', background: 'rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
                  SELECTED MEMBERS ({selectedIds.length} / 10)
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                  {selectedIds.map(id => {
                    const a = allAgents.find(agent => agent.id === id);
                    if (!a) return null;
                    const isTL = tlId === id;
                    return (
                      <div key={id} style={{
                        padding: '12px 16px', borderRadius: '16px', background: 'var(--bg-input)', 
                        border: isTL ? '1px solid var(--accent)' : '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: '16px'
                      }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>{a.avatar}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{a.name}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button 
                            onClick={() => setTlId(isTL ? undefined : id)}
                            style={{
                              padding: '6px 12px', borderRadius: '8px', border: 'none',
                              background: isTL ? 'var(--accent)' : 'var(--bg-hover)',
                              color: isTL ? '#fff' : 'var(--text-secondary)',
                              fontSize: '12px', fontWeight: 'bold', cursor: 'pointer'
                            }}
                          >
                            TL
                          </button>
                          <button 
                            onClick={() => toggleAgent(id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '20px', padding: '4px' }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>TEAM NAME</label>
                  <input 
                    value={teamName}
                    placeholder="Enter team name"
                    onChange={(e) => setTeamName(e.target.value)}
                    style={{ 
                      width: '100%', padding: '14px', borderRadius: '14px', 
                      border: '1px solid var(--border)', background: 'var(--bg-input)', 
                      color: 'var(--text-primary)', fontSize: '16px', fontWeight: '500'
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <OrchestrationCanvas 
                selectedAgents={selectedAgentObjects} 
                plan={orchestration}
                onChange={setOrchestration}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '32px 40px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '12px 32px', background: 'transparent', border: '1px solid var(--border)', 
              color: 'var(--text-primary)', borderRadius: '14px', cursor: 'pointer', fontWeight: '600' 
            }}
          >
            Cancel
          </button>
          
          {step === 1 ? (
            <button 
              onClick={() => {
                if (selectedIds.length === 0) { alert("Select at least one agent"); return; }
                if (!teamName.trim()) { alert("Enter team name"); return; }
                setStep(2);
              }}
              style={{ 
                padding: '12px 48px', background: 'var(--accent)', color: '#fff', border: 'none', 
                borderRadius: '14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px'
              }}
            >
              Next: Strategy Canvas
            </button>
          ) : (
            <>
              <button 
                onClick={() => setStep(1)}
                style={{ 
                  padding: '12px 32px', background: 'transparent', border: '1px solid var(--border)', 
                  color: 'var(--text-primary)', borderRadius: '14px', cursor: 'pointer', fontWeight: '600' 
                }}
              >
                Back
              </button>
              <button 
                onClick={handleConfirm}
                style={{ 
                  padding: '12px 48px', background: '#34c759', color: '#fff', border: 'none', 
                  borderRadius: '14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px',
                  boxShadow: '0 4px 15px rgba(52, 199, 89, 0.3)'
                }}
              >
                Confirm & Create
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamManagementModal;
