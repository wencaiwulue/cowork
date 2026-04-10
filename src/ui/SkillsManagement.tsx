import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface Skill {
  id: string;
  name: string;
  description: string;
}

const SkillsManagement: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [newSkill, setNewSkill] = useState({ name: '', description: '' });
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    try {
      const response = await fetch(`${backendUrl}/skills`);
      if (response.ok) setSkills(await response.json());
    } catch (err) { console.error(err); }
  };

  const addSkill = async () => {
    if (!newSkill.name) return;
    try {
      const response = await fetch(`${backendUrl}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSkill)
      });
      if (response.ok) {
        setNewSkill({ name: '', description: '' });
        fetchSkills();
      }
    } catch (err) { console.error(err); }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', color: 'var(--text-primary)' }}>
      <h2 style={{ marginBottom: '24px' }}>🧩 Skills Management</h2>
      
      <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', marginBottom: '32px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Register New Skill</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input 
            placeholder="Skill Name (e.g., Python Research)" 
            value={newSkill.name}
            onChange={(e) => setNewSkill({...newSkill, name: e.target.value})}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
          <textarea 
            placeholder="Description..." 
            value={newSkill.description}
            onChange={(e) => setNewSkill({...newSkill, description: e.target.value})}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', minHeight: '80px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
          <button 
            onClick={addSkill}
            style={{ padding: '12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600' }}
          >
            Add Skill
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
        {skills.map(skill => (
          <div key={skill.id} style={{ background: 'var(--bg-input)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>🧩 {skill.name}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{skill.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkillsManagement;
