import React, { useState } from 'react';
import Sidebar from './Sidebar';
import AgentLibrary from './AgentLibrary';
import TeamLibrary from './TeamLibrary';
import TeamChat from './TeamChat';
import FileExplorer from './FileExplorer';
import SkillsManagement from './SkillsManagement';
import ScheduledTasks from './ScheduledTasks';
import Connectors from './Connectors';
import Channels from './Channels';
import Pairings from './Pairings';
import MessageView from './MessageView';
import Settings from './Settings';
import '../index.css';

const App: React.FC = () => {
  const [view, setView] = useState<'agents' | 'team' | 'chat' | 'skills' | 'schedules' | 'connectors' | 'channels' | 'pairings' | 'settings' | 'create-team'>('chat');
  const [prevView, setPrevView] = useState<'agents' | 'team' | 'chat' | 'skills' | 'schedules' | 'connectors' | 'channels' | 'pairings' | 'settings' | 'create-team'>('chat');
  const [selectedTeamName, setSelectedTeamName] = useState<string>('dev-team');
  const [showFiles, setShowFiles] = useState(false);

  const handleViewChange = (newView: typeof view) => {
    if (newView === 'create-team') {
      setPrevView(view);
    }
    setView(newView);
  };

  // Listen for session creation to update the selected conversation
  React.useEffect(() => {
    const handler = (e: any) => {
      setSelectedTeamName(e.detail);
    };
    window.addEventListener('session-created', handler);
    return () => window.removeEventListener('session-created', handler);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--bg-primary)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Sidebar 
        currentView={view} 
        onViewChange={handleViewChange} 
        selectedTeamName={selectedTeamName}
        onTeamChange={setSelectedTeamName}
      />

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--bg-primary)' }}>
        {view === 'agents' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <AgentLibrary 
              onChat={(id) => {
                setSelectedTeamName(id);
                handleViewChange('chat');
              }} 
              onCreateTeam={(id) => handleViewChange('team')}
            />
          </div>
        )}
        {(view === 'team' || view === 'create-team') && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <TeamLibrary 
              initialCreate={view === 'create-team'}
              onCloseCreate={() => setView(prevView === 'create-team' ? 'team' : prevView)}
              onOpenChat={(name) => {
                setSelectedTeamName(name);
                handleViewChange('chat');
              }}
            />
          </div>
        )}
        {view === 'skills' && <div style={{ flex: 1, overflowY: 'auto' }}><SkillsManagement /></div>}
        {view === 'schedules' && <div style={{ flex: 1, overflowY: 'auto' }}><ScheduledTasks /></div>}
        {view === 'connectors' && <div style={{ flex: 1, overflowY: 'auto' }}><Connectors /></div>}
        {view === 'channels' && <div style={{ flex: 1, overflowY: 'auto' }}><Channels /></div>}
        {view === 'pairings' && <div style={{ flex: 1, overflowY: 'auto' }}><Pairings /></div>}
        {view === 'settings' && <div style={{ flex: 1, overflowY: 'auto' }}><Settings /></div>}
        {view === 'chat' && (
          <TeamChat 
            selectedTeamName={selectedTeamName} 
            showFiles={showFiles} 
            onToggleFiles={() => setShowFiles(!showFiles)} 
          />
        )}
      </main>

      {/* Right Sidebar: File Explorer */}
      {showFiles && <FileExplorer />}
    </div>
  );
};

export default App;
