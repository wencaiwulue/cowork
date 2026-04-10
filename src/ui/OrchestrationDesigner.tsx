import React, { useState } from 'react';

export type OrchestrationMode = 'supervisor' | 'pipeline' | 'parallel' | 'reflection' | 'debate';

export interface OrchestrationNode {
  mode: OrchestrationMode;
  agents: string[]; // IDs
  children?: OrchestrationNode[];
  config?: Record<string, any>;
}

interface Props {
  selectedAgents: { id: string; name: string; avatar: string }[];
  plan?: OrchestrationNode;
  onChange: (plan: OrchestrationNode) => void;
}

const OrchestrationDesigner: React.FC<Props> = ({ selectedAgents, plan, onChange }) => {
  const modes: { value: OrchestrationMode; label: string; icon: string; desc: string }[] = [
    { value: 'supervisor', label: 'Supervisor', icon: '👑', desc: 'One leader delegates to members.' },
    { value: 'pipeline', label: 'Pipeline', icon: '➡️', desc: 'Sequential execution: A -> B -> C.' },
    { value: 'parallel', label: 'Parallel', icon: '🔀', desc: 'Simultaneous execution & aggregation.' },
    { value: 'reflection', label: 'Reflection', icon: '🔁', desc: 'Iterative review & improvement loop.' },
    { value: 'debate', label: 'Debate', icon: '⚖️', desc: 'Agents discuss/argue for best result.' }
  ];

  const defaultPlan: OrchestrationNode = plan || {
    mode: 'supervisor',
    agents: selectedAgents.map(a => a.id)
  };

  const updateMode = (mode: OrchestrationMode) => {
    onChange({ ...defaultPlan, mode });
  };

  const updateConfig = (key: string, value: any) => {
    onChange({
      ...defaultPlan,
      config: { ...(defaultPlan.config || {}), [key]: value }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', color: 'var(--text-primary)' }}>
      <div>
        <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Orchestration Strategy</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Choose how your agents collaborate on tasks.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {modes.map(m => (
          <div 
            key={m.value}
            onClick={() => updateMode(m.value)}
            style={{
              padding: '16px',
              borderRadius: '16px',
              background: defaultPlan.mode === m.value ? 'rgba(0, 122, 255, 0.1)' : 'var(--bg-input)',
              border: defaultPlan.mode === m.value ? '2px solid var(--accent)' : '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>{m.icon}</div>
            <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{m.label}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>{m.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg-input)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
        <h4 style={{ fontSize: '14px', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Configuration</h4>
        
        {defaultPlan.mode === 'reflection' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '14px' }}>Max Loops:</span>
            <input 
              type="number" 
              value={defaultPlan.config?.max_loops || 3}
              onChange={(e) => updateConfig('max_loops', parseInt(e.target.value))}
              style={{ width: '60px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            />
          </div>
        )}

        {defaultPlan.mode === 'pipeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Order: {selectedAgents.map(a => a.name).join(' → ')}</p>
          </div>
        )}

        {defaultPlan.mode === 'supervisor' && (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>The designated Team Lead will oversee all other members.</p>
        )}

        {defaultPlan.mode === 'parallel' && (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>All members will work on the task simultaneously.</p>
        )}

        {defaultPlan.mode === 'debate' && (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Members will take turns critiquing each other's outputs.</p>
        )}
      </div>

      {/* Visual Representation */}
      <div style={{ 
        height: '120px', border: '1px dashed var(--border)', borderRadius: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {selectedAgents.map((a, i) => (
            <React.Fragment key={a.id}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-input)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {a.avatar}
              </div>
              {i < selectedAgents.length - 1 && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  {defaultPlan.mode === 'pipeline' ? '→' : (defaultPlan.mode === 'parallel' ? '+' : '•')}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OrchestrationDesigner;
