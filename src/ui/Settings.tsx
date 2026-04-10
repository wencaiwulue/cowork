import React, { useState, useEffect } from 'react';
import { Theme, applyTheme } from '../utils/theme';
import { getBackendUrl } from '../utils/config';

const Settings: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('app-theme') as Theme) || 'dark';
  });
  
  const [llmConfig, setLlmConfig] = useState({
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    model: 'gpt-4o'
  });
  
  const [skillhubRepo, setSkillhubRepo] = useState('https://skillsmp.com');
  const [memoryProvider, setMemoryProvider] = useState('mem0');
  const [loading, setLoading] = useState(false);
  const backendUrl = getBackendUrl();

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetch(`${backendUrl}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.llm) setLlmConfig(data.llm);
        setSkillhubRepo(data.skillhub_repo || 'https://skillsmp.com');
        setMemoryProvider(data.memory_provider || 'mem0');
      })
      .catch(err => console.error(err));
  }, []);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem('app-theme', newTheme);
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          llm: llmConfig,
          skillhub_repo: skillhubRepo,
          memory_provider: memoryProvider 
        })
      });
      if (response.ok) {
        alert('Settings saved!');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px', borderRadius: '8px', 
    border: '1px solid var(--border)', background: 'var(--bg-primary)', 
    color: 'var(--text-primary)', fontSize: '14px'
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', color: 'var(--text-primary)' }}>
      <h2 style={{ marginBottom: '24px' }}>⚙️ Settings</h2>
      
      {/* LLM Configuration */}
      <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', marginBottom: '24px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>LLM Configuration (Global)</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          These settings will be used by all agents by default.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>BASE URL</label>
            <input 
              value={llmConfig.base_url}
              onChange={(e) => setLlmConfig({...llmConfig, base_url: e.target.value})}
              placeholder="https://api.openai.com/v1"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>API KEY</label>
            <input 
              type="password"
              value={llmConfig.api_key}
              onChange={(e) => setLlmConfig({...llmConfig, api_key: e.target.value})}
              placeholder="sk-..."
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>DEFAULT MODEL</label>
            <input 
              value={llmConfig.model}
              onChange={(e) => setLlmConfig({...llmConfig, model: e.target.value})}
              placeholder="gpt-4o"
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', marginBottom: '24px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Appearance</h3>
        <div style={{ display: 'flex', gap: '12px' }}>
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <button key={t} onClick={() => handleThemeChange(t)} style={{ flex: 1, padding: '16px', borderRadius: '8px', border: theme === t ? '2px solid var(--accent)' : '1px solid var(--border)', background: theme === t ? 'rgba(0, 122, 255, 0.1)' : 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '20px' }}>{t === 'light' ? '☀️' : t === 'dark' ? '🌙' : '🖥️'}</div>
              <div style={{ fontSize: '14px', fontWeight: '600', textTransform: 'capitalize' }}>{t}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Memory Provider */}
      <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', marginBottom: '24px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Long-term Memory Provider</h3>
        <select 
          value={memoryProvider}
          onChange={(e) => setMemoryProvider(e.target.value)}
          style={inputStyle}
        >
          <option value="mem0">Mem0 (Vector Graph Memory)</option>
          <option value="sqlite">SQLite (Local Database)</option>
          <option value="file">Local File (JSONL)</option>
        </select>
      </div>

      {/* SkillHub Repository */}
      <div style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', marginBottom: '32px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>SkillHub Repository</h3>
        <input 
          value={skillhubRepo}
          onChange={(e) => setSkillhubRepo(e.target.value)}
          placeholder="https://skillsmp.com"
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button 
          onClick={handleSaveSettings}
          disabled={loading}
          style={{ padding: '12px 48px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          {loading ? 'Saving...' : 'Save All Settings'}
        </button>
      </div>
    </div>
  );
};

export default Settings;
