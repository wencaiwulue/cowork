import React from 'react';

interface MessageViewProps {
  title: string;
  description: string;
}

const MessageView: React.FC<MessageViewProps> = ({ title, description }) => {
  const dummyMessages = [
    { sender: 'System', content: `Welcome to the ${title} channel!`, time: '10:00 AM' },
    { sender: 'User', content: 'What can you do for me today?', time: '10:05 AM' },
    { sender: title, content: description, time: '10:06 AM' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>{title}</h2>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>12:55 PM</div>
      </div>

      <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        {dummyMessages.map((m, i) => (
          <div key={i} style={{ marginBottom: '24px', display: 'flex', gap: '12px', justifyContent: m.sender === 'User' ? 'flex-end' : 'flex-start' }}>
            {m.sender !== 'User' && (
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                {m.sender[0]}
              </div>
            )}
            <div style={{ maxWidth: '70%', textAlign: m.sender === 'User' ? 'right' : 'left' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{m.sender} • {m.time}</div>
              <div style={{ 
                padding: '12px 16px', 
                borderRadius: '12px', 
                background: m.sender === 'User' ? 'var(--accent)' : 'var(--bg-input)',
                color: m.sender === 'User' ? '#fff' : 'var(--text-primary)',
                fontSize: '14px',
                lineHeight: '1.5',
                border: m.sender === 'User' ? 'none' : '1px solid var(--border)'
              }}>
                {m.content}
              </div>
            </div>
            {m.sender === 'User' && (
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>U</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '24px' }}>
        <div style={{ background: 'var(--bg-input)', borderRadius: '16px', border: '1px solid var(--border)', padding: '12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input 
            placeholder={`Message ${title}...`}
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '14px' }}
          />
          <button style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>↑</button>
        </div>
      </div>
    </div>
  );
};

export default MessageView;
