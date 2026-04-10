import React, { useState, useEffect, useRef } from 'react';
import { getBackendUrl } from '../utils/config';

interface Schedule {
  id: string;
  name: string;
  cron: string;
  task: string;
  target_id: string;
  target_type: 'agent' | 'team';
  enabled: boolean;
  last_run_status: string;
  next_run_time: string;
  created_at?: number;
}

const ScheduledTasks: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agents, setAgents] = useState<{id: string, name: string}[]>([]);
  const [teams, setTeams] = useState<{name: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [newSchedule, setNewSchedule] = useState({ 
    name: '', cron: '*/5 * * * *', task: '', 
    target_id: '', target_type: 'agent' as 'agent' | 'team' 
  });
  
  const backendUrl = getBackendUrl();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSchedules();
    fetchTargets();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSchedules = async () => {
    try {
      const response = await fetch(`${backendUrl}/schedules`);
      if (response.ok) {
        const data = await response.json();
        setSchedules(data);
      }
    } catch (err) { console.error(err); }
  };

  const fetchTargets = async () => {
    try {
      const [resAgents, resTeams] = await Promise.all([
        fetch(`${backendUrl}/agents`),
        fetch(`${backendUrl}/teams`)
      ]);
      if (resAgents.ok) setAgents(await resAgents.json());
      if (resTeams.ok) setTeams(await resTeams.json());
    } catch (err) { console.error(err); }
  };

  const addSchedule = async () => {
    if (!newSchedule.name || !newSchedule.task || !newSchedule.target_id) return;
    try {
      const response = await fetch(`${backendUrl}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newSchedule, enabled: true, created_at: Date.now() / 1000 })
      });
      if (response.ok) {
        setShowModal(false);
        setNewSchedule({ name: '', cron: '*/5 * * * *', task: '', target_id: '', target_type: 'agent' });
        fetchSchedules();
      }
    } catch (err) { console.error(err); }
  };

  const toggleEnable = async (id: string, current: boolean) => {
    try {
      await fetch(`${backendUrl}/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !current })
      });
      fetchSchedules();
    } catch (err) { console.error(err); }
  };

  const deleteSchedule = async (id: string) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await fetch(`${backendUrl}/schedules/${id}`, { method: 'DELETE' });
      fetchSchedules();
      setOpenMenuId(null);
    } catch (err) { console.error(err); }
  };

  const runNow = async (id: string) => {
    try {
      const response = await fetch(`${backendUrl}/schedules/${id}/run`, { method: 'POST' });
      if (response.ok) {
        alert('Task execution triggered!');
        setOpenMenuId(null);
        fetchSchedules(); // Refresh the card status
        // Trigger a global refresh for chat windows
        window.dispatchEvent(new CustomEvent('refresh-chat'));
      }
    } catch (err) { console.error(err); }
  };

  const filteredSchedules = schedules.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.task.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)', background: 'var(--bg-primary)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>Schedules</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Automate agent tasks with precise timing
          </p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          style={{ 
            padding: '12px 24px', background: 'var(--accent)', color: '#fff', 
            border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' 
          }}
        >
          + New Schedule
        </button>
      </div>

      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '32px' }}>
        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
        <input 
          type="text" 
          placeholder="Search schedules..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ 
            width: '100%', padding: '12px 12px 12px 40px', borderRadius: '12px', 
            border: '1px solid var(--border)', background: 'var(--bg-sidebar)', 
            color: 'var(--text-primary)', fontSize: '14px' 
          }}
        />
      </div>

      {/* Cards Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', 
        gap: '24px' 
      }}>
        {filteredSchedules.map(s => (
          <div key={s.id} style={{ 
            background: 'var(--bg-input)', 
            borderRadius: '24px', 
            padding: '24px', 
            border: '1px solid var(--border)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            opacity: s.enabled ? 1 : 0.6,
            transition: 'opacity 0.3s'
          }}>
            {/* Top Row: Title & Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>{s.name}</h3>
              <div 
                onClick={() => toggleEnable(s.id, s.enabled)}
                style={{ 
                  width: '44px', height: '24px', background: s.enabled ? '#34c759' : 'var(--bg-hover)', 
                  borderRadius: '12px', position: 'relative', cursor: 'pointer', transition: 'all 0.3s' 
                }}
              >
                <div style={{ 
                  width: '20px', height: '20px', background: '#fff', borderRadius: '50%', 
                  position: 'absolute', top: '2px', left: s.enabled ? '22px' : '2px', transition: 'all 0.3s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }} />
              </div>
            </div>

            {/* Description */}
            <div style={{ fontSize: '15px', color: 'var(--text-primary)', lineHeight: '1.5', minHeight: '45px' }}>
              {s.task}
            </div>

            {/* Schedule Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🕒</span>
                <span>Cron: <b>{s.cron}</b></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⌛</span>
                <span>Next: <b style={{ color: 'var(--text-primary)' }}>{s.next_run_time || 'Calculating...'}</b></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>📊</span>
                <span>Last Run: <b style={{ color: s.last_run_status === 'Success' ? '#34c759' : (s.last_run_status?.includes('Failed') ? '#ff453a' : 'var(--text-primary)') }}>{s.last_run_status || 'Never'}</b></span>
              </div>
            </div>

            {/* Bottom Actions */}
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === s.id ? null : s.id);
                }}
                style={{ 
                  background: 'rgba(255, 255, 255, 0.05)', border: 'none', color: 'var(--text-primary)', 
                  width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px'
                }}
              >
                •••
              </button>

              {openMenuId === s.id && (
                <div 
                  ref={menuRef}
                  style={{
                    position: 'absolute', bottom: '40px', right: '0', background: 'var(--bg-input)',
                    border: '1px solid var(--border)', borderRadius: '12px', width: '140px',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.3)', zIndex: 20, overflow: 'hidden'
                  }}
                >
                  <button 
                    onClick={() => runNow(s.id)}
                    style={{ 
                      width: '100%', padding: '12px 16px', background: 'transparent', border: 'none',
                      color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer', fontSize: '14px',
                      display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>▶</span> Run now
                  </button>
                  <div style={{ height: '1px', background: 'var(--border)' }} />
                  <button 
                    onClick={() => deleteSchedule(s.id)}
                    style={{ 
                      width: '100%', padding: '12px 16px', background: 'transparent', border: 'none',
                      color: '#ff453a', textAlign: 'left', cursor: 'pointer', fontSize: '14px',
                      display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>🗑️</span> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* New Schedule Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            width: '500px', background: 'var(--bg-primary)', padding: '32px',
            borderRadius: '24px', border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            <h2 style={{ margin: '0 0 24px 0' }}>New Schedule</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input placeholder="Name" value={newSchedule.name} onChange={(e) => setNewSchedule({...newSchedule, name: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <div style={{ display: 'flex', gap: '12px' }}>
                <select value={newSchedule.target_type} onChange={(e) => setNewSchedule({...newSchedule, target_type: e.target.value as any, target_id: ''})} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                  <option value="agent">Agent</option>
                  <option value="team">Team</option>
                </select>
                <select value={newSchedule.target_id} onChange={(e) => setNewSchedule({...newSchedule, target_id: e.target.value})} style={{ flex: 2, padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                  <option value="">Select Target...</option>
                  {newSchedule.target_type === 'agent' ? agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>) : teams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <input placeholder="Cron (e.g., */5 * * * *)" value={newSchedule.cron} onChange={(e) => setNewSchedule({...newSchedule, cron: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <textarea placeholder="Task Description..." value={newSchedule.task} onChange={(e) => setNewSchedule({...newSchedule, task: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', minHeight: '100px', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text-primary)' }}>Cancel</button>
                <button onClick={addSchedule} style={{ flex: 1, padding: '12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledTasks;
