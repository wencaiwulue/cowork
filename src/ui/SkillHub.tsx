import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface Skill {
  id: string;
  name: string;
  description: string;
  icon?: string;
  isInstalled?: boolean;
}

const SkillHub: React.FC = () => {
  const [hubSkills, setHubSkills] = useState<Skill[]>([]);
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [hubRes, localRes] = await Promise.all([
        fetch(`${backendUrl}/skillhub`),
        fetch(`${backendUrl}/skills`)
      ]);
      if (hubRes.ok) setHubSkills(await hubRes.json());
      if (localRes.ok) setInstalledSkills(await localRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const installSkill = async (skill: Skill) => {
    try {
      const url = new URL(`${backendUrl}/skills/install`);
      url.searchParams.append('skill_id', skill.id);
      if ((skill as any).remote_url) {
        url.searchParams.append('remote_url', (skill as any).remote_url);
      }
      
      const response = await fetch(url.toString(), {
        method: 'POST'
      });
      if (response.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const isInstalled = (id: string) => installedSkills.some(s => s.id === id);

  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>SkillHub</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Discover and install advanced capabilities for your agents.</p>
      </div>

      {loading ? (
        <div>Loading skills...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {hubSkills.map(skill => (
            <div key={skill.id} style={{ 
              background: 'var(--bg-input)', 
              padding: '24px', 
              borderRadius: '16px', 
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{ fontSize: '40px' }}>{skill.icon || '🧩'}</div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>{skill.name}</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', height: '40px', overflow: 'hidden' }}>
                  {skill.description}
                </p>
              </div>
              
              <button 
                onClick={() => !isInstalled(skill.id) && installSkill(skill)}
                disabled={isInstalled(skill.id)}
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  background: isInstalled(skill.id) ? 'var(--bg-hover)' : 'var(--accent)',
                  color: isInstalled(skill.id) ? 'var(--text-secondary)' : '#fff',
                  border: 'none',
                  fontWeight: '600',
                  cursor: isInstalled(skill.id) ? 'default' : 'pointer',
                  fontSize: '14px'
                }}
              >
                {isInstalled(skill.id) ? 'Installed' : 'Install Skill'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SkillHub;
