import React, { useState } from 'react';
import { OrchestrationNode, OrchestrationMode } from './OrchestrationDesigner';

interface Agent {
  id: string;
  name: string;
  avatar: string;
}

interface Props {
  selectedAgents: Agent[];
  plan: OrchestrationNode;
  onChange: (plan: OrchestrationNode) => void;
}

const OrchestrationCanvas: React.FC<Props> = ({ selectedAgents, plan, onChange }) => {
  const modes: { type: OrchestrationMode; label: string; icon: string; color: string }[] = [
    { type: 'supervisor', label: 'Supervisor', icon: '👑', color: '#ff9500' },
    { type: 'pipeline', label: 'Pipeline', icon: '➡️', color: '#007aff' },
    { type: 'parallel', label: 'Parallel', icon: '🔀', color: '#5856d6' },
    { type: 'reflection', label: 'Reflection', icon: '🔁', color: '#34c759' },
    { type: 'debate', label: 'Debate', icon: '⚖️', color: '#ff3b30' }
  ];

  const updateNode = (path: number[], updates: Partial<OrchestrationNode>) => {
    const newPlan = JSON.parse(jsonStringify(plan));
    let target = newPlan;
    for (const index of path) {
      if (!target.children) target.children = [];
      target = target.children[index];
    }
    Object.assign(target, updates);
    onChange(newPlan);
  };

  const addNode = (path: number[], mode: OrchestrationMode) => {
    const newPlan = JSON.parse(jsonStringify(plan));
    let target = newPlan;
    for (const index of path) {
      target = target.children[index];
    }
    if (!target.children) target.children = [];
    target.children.push({
      mode,
      agents: selectedAgents.slice(0, 1).map(a => a.id),
      children: []
    });
    onChange(newPlan);
  };

  const removeNode = (path: number[]) => {
    if (path.length === 0) return; // Cannot remove root
    const newPlan = JSON.parse(jsonStringify(plan));
    let target = newPlan;
    const lastIndex = path[path.length - 1];
    for (let i = 0; i < path.length - 1; i++) {
      target = target.children[path[i]];
    }
    target.children.splice(lastIndex, 1);
    onChange(newPlan);
  };

  // Safe stringify for complex objects
  const jsonStringify = (obj: any) => JSON.stringify(obj, (key, value) => value === undefined ? null : value);

  const renderNode = (node: OrchestrationNode, path: number[] = []) => {
    const modeInfo = modes.find(m => m.type === node.mode) || modes[0];
    const isRoot = path.length === 0;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px' }}>
        {/* Node Box */}
        <div style={{
          width: '240px',
          background: 'var(--bg-input)',
          border: `2px solid ${modeInfo.color}`,
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div style={{ fontSize: '24px' }}>{modeInfo.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: modeInfo.color, textTransform: 'uppercase' }}>Mode</div>
              <div style={{ fontSize: '15px', fontWeight: 'bold' }}>{modeInfo.label}</div>
            </div>
            {!isRoot && (
              <button onClick={() => removeNode(path)} style={{ background: 'transparent', border: 'none', color: '#ff453a', cursor: 'pointer' }}>×</button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>ASSIGNED AGENTS</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {selectedAgents.map(agent => {
                const isActive = node.agents.includes(agent.id);
                return (
                  <div 
                    key={agent.id}
                    onClick={() => {
                      const newAgents = isActive 
                        ? node.agents.filter(id => id !== agent.id)
                        : [...node.agents, agent.id];
                      updateNode(path, { agents: newAgents });
                    }}
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%', background: isActive ? 'var(--accent)' : 'var(--bg-hover)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', cursor: 'pointer',
                      border: isActive ? 'none' : '1px solid var(--border)', opacity: isActive ? 1 : 0.4
                    }}
                    title={agent.name}
                  >
                    {agent.avatar}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Sub-mode buttons */}
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border)', paddingTop: '12px', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>ADD SUB-STRATEGY:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {modes.slice(1).map(m => (
                <button 
                  key={m.type}
                  onClick={() => addNode(path, m.type)}
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                >
                  {m.icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Children Render */}
        {node.children && node.children.length > 0 && (
          <div style={{ display: 'flex', gap: '48px', position: 'relative' }}>
            {/* SVG Connection Lines */}
            <svg style={{ position: 'absolute', top: '-32px', left: 0, width: '100%', height: '32px', pointerEvents: 'none' }}>
              <path 
                d={`M ${120} 0 L ${120} 16`} 
                stroke={modeInfo.color} 
                strokeWidth="2" 
                fill="none" 
              />
            </svg>
            
            {node.children.map((child, idx) => (
              <div key={idx} style={{ position: 'relative' }}>
                {/* Visual Connector from parent line to this child */}
                {renderNode(child, [...path, idx])}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ 
      width: '100%', height: '500px', background: 'rgba(0,0,0,0.05)', 
      borderRadius: '24px', border: '1px solid var(--border)', 
      overflow: 'auto', padding: '40px', display: 'flex', justifyContent: 'center'
    }}>
      {renderNode(plan)}
    </div>
  );
};

export default OrchestrationCanvas;
