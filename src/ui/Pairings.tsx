import React from 'react';

const Pairings: React.FC = () => {
  const pairings = [
    { name: 'Research Pair', agents: ['Researcher', 'Summarizer'], type: 'Mutual' },
    { name: 'Coding Pair', agents: ['Architect', 'Coder'], type: 'Hierarchical' }
  ];

  return (
    <div style={{ padding: '40px', maxWidth: '800px', color: 'var(--text-primary)' }}>
      <h2 style={{ marginBottom: '24px' }}>👯 Pairings</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {pairings.map(p => (
          <div key={p.name} style={{ background: 'var(--bg-input)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>👯 {p.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#34c759', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{p.agents[0][0]}</div>
              <div style={{ fontSize: '20px', color: 'var(--text-secondary)' }}>↔</div>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{p.agents[1][0]}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Type: {p.type}</div>
              <button style={{ padding: '6px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Configure</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Pairings;
