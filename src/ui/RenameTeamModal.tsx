import React, { useState } from 'react';
import { getBackendUrl } from '../utils/config';

interface Props {
  oldName: string;
  onClose: () => void;
  onSuccess: (newName: string) => void;
}

const RenameTeamModal: React.FC<Props> = ({ oldName, onClose, onSuccess }) => {
  const [newName, setNewName] = useState(oldName);
  const [loading, setLoading] = useState(false);
  const backendUrl = getBackendUrl();

  const handleRename = async () => {
    if (!newName.trim() || newName === oldName) return;
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/teams/${encodeURIComponent(oldName)}/rename?new_name=${encodeURIComponent(newName)}`, {
        method: 'PUT'
      });
      if (response.ok) {
        onSuccess(newName);
      } else {
        const err = await response.json();
        alert(err.detail || 'Failed to rename team');
      }
    } catch (err) {
      console.error(err);
      alert('Could not reach backend');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
    }}>
      <div style={{
        width: '400px', background: 'var(--bg-primary)', padding: '32px',
        borderRadius: '24px', border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
      }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: 'var(--text-primary)' }}>Rename Team</h3>
        <p style={{ margin: '0 0 24px 0', color: 'var(--text-secondary)', fontSize: '14px' }}>Enter a new name for this team.</p>
        
        <input 
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          style={{ 
            width: '100%', padding: '14px', borderRadius: '12px', 
            border: '1px solid var(--border)', background: 'var(--bg-input)', 
            color: 'var(--text-primary)', fontSize: '16px', marginBottom: '24px'
          }}
        />

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{ padding: '10px 20px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: '600' }}
          >
            Cancel
          </button>
          <button 
            onClick={handleRename}
            disabled={loading || !newName.trim() || newName === oldName}
            style={{ 
              padding: '10px 24px', background: 'var(--accent)', color: '#fff', border: 'none', 
              borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameTeamModal;
