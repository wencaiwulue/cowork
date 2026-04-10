import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';
import TeamManagementModal from './TeamManagementModal';
import RenameTeamModal from './RenameTeamModal';

interface Team {
  name: string;
  agents: string[];
  tl_id?: string;
}

interface Agent {
  id: string;
  name: string;
  avatar: string;
}

interface TeamLibraryProps {
  onOpenChat: (teamName: string) => void;
  initialCreate?: boolean;
  onCloseCreate?: () => void;
}

const TeamLibrary: React.FC<TeamLibraryProps> = ({ onOpenChat, initialCreate, onCloseCreate }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(initialCreate || false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [renamingTeam, setRenamingTeam] = useState<Team | null>(null);
  
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (initialCreate) {
      setShowCreateModal(true);
    }
  }, [initialCreate]);

  const fetchData = async () => {
    try {
      const [teamsRes, agentsRes] = await Promise.all([
        fetch(`${backendUrl}/teams`),
        fetch(`${backendUrl}/agents`)
      ]);
      if (teamsRes.ok) setTeams(await teamsRes.json());
      if (agentsRes.ok) setAgents(await agentsRes.json());
    } catch (err) {
      console.error('Failed to fetch library data:', err);
    }
  };

  const handleDeleteTeam = async (name: string) => {
    if (!window.confirm(`Are you sure you want to delete team "${name}"?`)) return;
    try {
      const response = await fetch(`${backendUrl}/teams/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to delete team:', err);
    }
  };

  const filteredTeams = teams.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getTeamInitials = (name: string) => {
    if (!name) return '??';
    return name.split(/[\s-_]/).map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)', background: 'var(--bg-primary)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>Manage</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: 'var(--bg-input)', borderRadius: '20px', padding: '4px 12px', display: 'flex', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-primary)' }}>My Teams <span style={{ opacity: 0.6 }}>{teams.length}</span></span>
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
            <input 
              type="text" 
              placeholder="Search" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: '12px',
                padding: '8px 12px 8px 32px', color: 'var(--text-primary)', width: '200px', fontSize: '13px'
              }}
            />
          </div>
        </div>
      </div>

      {/* List Layout (Matching Screenshot) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredTeams.map(team => (
          <div key={team.name} style={{
            background: 'var(--bg-input)', borderRadius: '16px', padding: '16px 24px',
            display: 'flex', alignItems: 'center', border: '1px solid var(--border)'
          }}>
            {/* Initials Circle */}
            <div style={{ 
              width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-hover)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', color: 'var(--accent)',
              marginRight: '16px'
            }}>
              {getTeamInitials(team.name)}
            </div>

            {/* Team Info */}
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>{team.name}</h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {team.agents.length} agents
              </div>
            </div>

            {/* Action Buttons (Matching Screenshot) */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => onOpenChat(team.name)}
                style={{
                  padding: '6px 16px', borderRadius: '8px', background: 'var(--accent)',
                  color: '#fff', border: 'none', fontWeight: '600', fontSize: '13px', cursor: 'pointer'
                }}
              >
                Chat
              </button>
              <button 
                onClick={() => setEditingTeam(team)}
                style={{
                  padding: '6px 16px', borderRadius: '8px', background: 'var(--bg-hover)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: '600', fontSize: '13px', cursor: 'pointer'
                }}
              >
                Manage
              </button>
              <button 
                onClick={() => setRenamingTeam(team)}
                style={{
                  padding: '6px 16px', borderRadius: '8px', background: 'var(--bg-hover)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: '600', fontSize: '13px', cursor: 'pointer'
                }}
              >
                Rename
              </button>
              <button 
                onClick={() => handleDeleteTeam(team.name)}
                style={{
                  padding: '6px 16px', borderRadius: '8px', background: 'transparent',
                  color: '#ff453a', border: '1px solid rgba(255, 69, 58, 0.3)', fontWeight: '600', fontSize: '13px', cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {/* Empty State / Create Shortcut */}
        {filteredTeams.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border)', borderRadius: '16px' }}>
            No teams found. <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => setShowCreateModal(true)}>Create one?</span>
          </div>
        )}
      </div>

      {showCreateModal && (
        <TeamManagementModal 
          team={{ name: '', agents: [] }} 
          onClose={() => { 
            setShowCreateModal(false); 
            fetchData(); 
            if (onCloseCreate) onCloseCreate();
          }}
        />
      )}

      {editingTeam && (
        <TeamManagementModal 
          team={editingTeam} 
          onClose={() => { setEditingTeam(null); fetchData(); }}
        />
      )}

      {renamingTeam && (
        <RenameTeamModal 
          oldName={renamingTeam.name}
          onClose={() => setRenamingTeam(null)}
          onSuccess={() => { setRenamingTeam(null); fetchData(); }}
        />
      )}
    </div>
  );
};

export default TeamLibrary;
