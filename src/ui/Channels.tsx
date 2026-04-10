import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface Channel {
  id: string;
  name: string;
  type: string;
  status: 'Online' | 'Offline' | 'Busy';
}

const Channels: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [newChannel, setNewChannel] = useState({ name: '', type: 'Public', status: 'Online' });
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const response = await fetch(`${backendUrl}/channels`);
      if (response.ok) {
        const data = await response.json();
        if (data.length === 0) {
          const defaults: any[] = [
            { name: 'General', type: 'Public', status: 'Online' },
            { name: 'Dev Team', type: 'Private', status: 'Busy' },
            { name: 'Design Sync', type: 'Public', status: 'Online' }
          ];
          setChannels(defaults);
        } else {
          setChannels(data);
        }
      }
    } catch (err) { console.error(err); }
  };

  const addChannel = async () => {
    if (!newChannel.name) return;
    try {
      const response = await fetch(`${backendUrl}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newChannel)
      });
      if (response.ok) {
        setNewChannel({ name: '', type: 'Public', status: 'Online' });
        fetchChannels();
      }
    } catch (err) { console.error(err); }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', color: 'var(--text-primary)' }}>
      <h2 style={{ marginBottom: '24px' }}>📺 Channels</h2>
      
      <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', marginBottom: '32px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Create New Channel</h3>
        <div style={{ display: 'flex', gap: '12px' }}>
          <input 
            placeholder="Channel Name" 
            value={newChannel.name}
            onChange={(e) => setNewChannel({...newChannel, name: e.target.value})}
            style={{ flex: 2, padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
          <select 
            value={newChannel.type}
            onChange={(e) => setNewChannel({...newChannel, type: e.target.value})}
            style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          >
            <option value="Public">Public</option>
            <option value="Private">Private</option>
          </select>
          <button 
            onClick={addChannel}
            style={{ padding: '12px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
          >
            Add
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {channels.map(c => (
          <div key={c.name} style={{ background: 'var(--bg-input)', padding: '16px 24px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px', color: 'var(--text-primary)' }}>📺 {c.name}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Type: {c.type}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: c.status === 'Online' ? '#34c759' : (c.status === 'Busy' ? '#ff9500' : '#ff3b30') }}></div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{c.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Channels;
