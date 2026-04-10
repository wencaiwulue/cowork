import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface Connector {
  id: string;
  name: string;
  icon: string;
  status: 'Connected' | 'Disconnected';
}

const Connectors: React.FC = () => {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchConnectors();
  }, []);

  const fetchConnectors = async () => {
    try {
      const response = await fetch(`${backendUrl}/connectors`);
      if (response.ok) {
        const data = await response.json();
        if (data.length === 0) {
          // Initialize with defaults if empty
          const defaults: any[] = [
            { name: 'Slack', icon: '💬', status: 'Connected' },
            { name: 'GitHub', icon: '🐙', status: 'Disconnected' },
            { name: 'Discord', icon: '🎮', status: 'Connected' }
          ];
          setConnectors(defaults);
        } else {
          setConnectors(data);
        }
      }
    } catch (err) { console.error(err); }
  };

  const toggleStatus = async (connector: Connector) => {
    const updated = { ...connector, status: connector.status === 'Connected' ? 'Disconnected' : 'Connected' };
    try {
      const response = await fetch(`${backendUrl}/connectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (response.ok) fetchConnectors();
    } catch (err) { console.error(err); }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', color: 'var(--text-primary)' }}>
      <h2 style={{ marginBottom: '24px' }}>🔗 Connectors</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>Manage external service connections for your agents.</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
        {connectors.map(c => (
          <div key={c.name} style={{ background: 'var(--bg-input)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '24px' }}>{c.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{c.name}</div>
              <div style={{ fontSize: '12px', color: c.status === 'Connected' ? '#34c759' : 'var(--text-secondary)' }}>{c.status}</div>
            </div>
            <button 
              onClick={() => toggleStatus(c)}
              style={{ 
                padding: '6px 12px', borderRadius: '8px', 
                background: c.status === 'Connected' ? 'rgba(255, 59, 48, 0.1)' : 'rgba(52, 199, 89, 0.1)', 
                border: 'none', color: c.status === 'Connected' ? '#ff3b30' : '#34c759', 
                fontSize: '12px', fontWeight: '600', cursor: 'pointer' 
              }}
            >
              {c.status === 'Connected' ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Connectors;
