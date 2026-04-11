import React from 'react';
import { DraftAgent } from './WizardStore';

interface LivePreviewProps {
  draft: DraftAgent;
}

const LivePreview: React.FC<LivePreviewProps> = ({ draft }) => {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: '12px',
      background: 'var(--bg-input)',
      padding: '24px',
      boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      height: 'fit-content',
      color: 'var(--text-primary)'
    }}>
      <h3 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Live Preview</h3>
      
      {/* Avatar Container */}
      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '32px',
        border: '2px solid var(--accent)',
        margin: '0 auto'
      }}>
        {draft.avatar.startsWith('Pixel') ? '🤖' : draft.avatar}
      </div>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '20px' }}>{draft.name || 'Agent Name'}</h2>
        <div style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          background: 'rgba(0, 122, 255, 0.1)',
          color: 'var(--accent)',
          fontSize: '12px',
          fontWeight: 'bold'
        }}>
          {draft.vibe}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>{draft.description || 'No description provided.'}</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {draft.tools.map(tool => (
          <span key={tool} style={{ 
            fontSize: '11px', 
            background: 'var(--bg-hover)', 
            padding: '2px 8px', 
            borderRadius: '10px',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)'
          }}>
            🛠 {tool}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {draft.skills.filter(s => s).map(skill => (
          <span key={skill} style={{ 
            fontSize: '11px', 
            background: 'rgba(255, 214, 10, 0.1)', 
            padding: '2px 8px', 
            borderRadius: '10px',
            color: '#ffd60a',
            border: '1px solid rgba(255, 214, 10, 0.3)'
          }}>
            🌟 {skill}
          </span>
        ))}
      </div>
    </div>
  );
};

export default LivePreview;
