import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface MemoryItem {
  id: string;
  text: string;
  created_at?: string;
  metadata?: any;
}

interface Props {
  agentId: string;
  agentName: string;
  onBack: () => void;
}

const MemoryView: React.FC<Props> = ({ agentId, agentName, onBack }) => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchMemories();
  }, [agentId]);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/agents/${agentId}/memories`);
      if (response.ok) {
        const data = await response.json();
        // Mem0 return format can vary, handle both list and object with results
        setMemories(Array.isArray(data) ? data : (data.results || []));
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    } finally {
      setLoading(false);
    }
  };

  const forgetMemory = async (memoryId: string) => {
    try {
      const response = await fetch(`${backendUrl}/agents/${agentId}/memories/${memoryId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setMemories(prev => prev.filter(m => m.id !== memoryId));
      }
    } catch (err) {
      console.error('Failed to forget memory:', err);
    }
  };

  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <button 
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '20px' }}
        >
          ←
        </button>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold' }}>Long-term Memory: {agentName}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Mem0 self-improving memory layer. Stores extracted facts and preferences.</p>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading memories...</div>
      ) : memories.length === 0 ? (
        <div style={{ 
          padding: '60px', border: '2px dashed var(--border)', borderRadius: '24px', 
          textAlign: 'center', color: 'var(--text-secondary)' 
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧠</div>
          <h3>No memories yet</h3>
          <p>Start a conversation with this agent to build its long-term memory.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {memories.map((mem) => (
            <div key={mem.id} style={{ 
              background: 'var(--bg-input)', padding: '20px', borderRadius: '16px', 
              border: '1px solid var(--border)', display: 'flex', gap: '16px', alignItems: 'flex-start'
            }}>
              <div style={{ fontSize: '20px' }}>💡</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '15px', lineHeight: '1.6', margin: 0 }}>{mem.text}</p>
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', gap: '12px' }}>
                  <span>ID: {mem.id.slice(0, 8)}</span>
                  {mem.created_at && <span>Stored: {new Date(mem.created_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <button 
                onClick={() => forgetMemory(mem.id)}
                style={{ background: 'transparent', border: 'none', color: '#ff453a', cursor: 'pointer', fontSize: '14px' }}
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemoryView;
