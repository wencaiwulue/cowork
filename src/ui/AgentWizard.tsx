import React, { useState, useEffect } from 'react';
import { WizardStore, DraftAgent } from './WizardStore';
import LivePreview from './LivePreview';
import { getBackendUrl } from '../utils/config';

interface AgentWizardProps {
  onSuccess?: () => void;
}

const AgentWizard: React.FC<AgentWizardProps> = ({ onSuccess }) => {
  const store = WizardStore.getInstance();
  const [currentStep, setCurrentStep] = useState(store.getCurrentStep());
  const [draft, setDraft] = useState<DraftAgent>(store.getDraftAgent());
  const [installedSkills, setInstalledSkills] = useState<{id: string, name: string}[]>([]);
  const [hubSearch, setHubSearch] = useState('');
  const [hubResults, setHubSearchData] = useState<{id: string, name: string, description?: string}[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetch(`${backendUrl}/skills`)
      .then(res => res.json())
      .then(data => setInstalledSkills(data))
      .catch(err => console.error(err));
  }, []);

  // Fetch initial hub results
  useEffect(() => {
    if (currentStep === 3) {
      fetch(`${backendUrl}/skillhub`)
        .then(res => res.json())
        .then(data => setHubSearchData(data))
        .catch(err => console.error(err));
    }
  }, [currentStep]);

  // Search debounce
  useEffect(() => {
    if (currentStep === 3 && hubSearch) {
      const delayDebounceFn = setTimeout(() => {
        fetch(`${backendUrl}/skillhub?q=${encodeURIComponent(hubSearch)}`)
          .then(res => res.json())
          .then(data => setHubSearchData(data))
          .catch(err => console.error(err));
      }, 300);
      return () => clearTimeout(delayDebounceFn);
    } else if (currentStep === 3 && !hubSearch) {
      fetch(`${backendUrl}/skillhub`)
        .then(res => res.json())
        .then(data => setHubSearchData(data))
        .catch(err => console.error(err));
    }
  }, [hubSearch]);

  useEffect(() => {
    const handleStepUpdate = (step: number) => setCurrentStep(step);
    const handleDraftUpdate = (updatedDraft: DraftAgent) => setDraft(updatedDraft);
    const handleReset = () => {
      setCurrentStep(store.getCurrentStep());
      setDraft(store.getDraftAgent());
    };
    store.on('STEP_UPDATE', handleStepUpdate);
    store.on('DRAFT_UPDATE', handleDraftUpdate);
    store.on('RESET', handleReset);
    return () => {
      store.off('STEP_UPDATE', handleStepUpdate);
      store.off('DRAFT_UPDATE', handleDraftUpdate);
      store.off('RESET', handleReset);
    };
  }, []);

  const handleInputChange = (field: keyof DraftAgent, value: any) => {
    store.updateDraft({ [field]: value });
  };

  const handleUserProfileChange = (field: string, value: string) => {
    store.updateDraft({ userProfile: { ...draft.userProfile, [field]: value } });
  };

  const handleNext = async () => {
    if (currentStep < 4) {
      store.setStep(currentStep + 1);
    } else {
      setIsCreating(true);
      try {
        const response = await fetch(`${backendUrl}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
            vibe: draft.vibe,
            avatar: draft.avatar,
            tools: draft.tools,
            skills: draft.skills,
            llm: null, // Global settings used in runner
            user_profile: draft.userProfile,
            core_files: null // Let backend generate them from templates
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log("Agent and core files generated successfully:", result);
          store.reset();
          if (onSuccess) onSuccess();
        } else {
          alert('Failed to create agent. Please check the backend.');
        }
      } catch (err) {
        console.error('API Error:', err);
        alert('Could not reach backend.');
      } finally {
        setIsCreating(false);
      }
    }
  };

  const handleBack = () => { if (currentStep > 1) store.setStep(currentStep - 1); };

  const inputStyle = {
    width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '15px'
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>Identity & Style</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Define your agent's name, description and personality vibe</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>NAME *</label>
                <input value={draft.name} onChange={(e) => handleInputChange('name', e.target.value)} placeholder="e.g. My Coder" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>VIBE</label>
                <select value={draft.vibe} onChange={(e) => handleInputChange('vibe', e.target.value)} style={inputStyle}>
                  <option value="Professional">Professional</option>
                  <option value="Creative">Creative</option>
                  <option value="Analytical">Analytical</option>
                  <option value="Friendly">Friendly</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>AVATAR</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {['🤖', '👩‍💻', '👨‍🚀', '👾', '🦊', '⚡', '🔬'].map(emoji => (
                  <div 
                    key={emoji} 
                    onClick={() => handleInputChange('avatar', emoji)} 
                    style={{ 
                      width: '48px', height: '48px', borderRadius: '12px', 
                      background: draft.avatar === emoji ? 'var(--bg-hover)' : 'var(--bg-input)', 
                      border: draft.avatar === emoji ? '2px solid var(--accent)' : '1px solid var(--border)', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', cursor: 'pointer' 
                    }}
                  >
                    {emoji}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>DESCRIPTION</label>
              <textarea value={draft.description} onChange={(e) => handleInputChange('description', e.target.value)} placeholder="What is this agent's primary goal?" style={{ ...inputStyle, height: '100px', resize: 'none' }} />
            </div>
          </div>
        );
      case 2:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '28px' }}>Tools</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {[
                { name: 'File System', icon: '📄' }, { name: 'Web & Browse', icon: '🌐' },
                { name: 'Sourcing', icon: '📦' }, { name: 'Code & Terminal', icon: '⌨️' },
                { name: 'Image & Media', icon: '🎨' }, { name: 'Utilities', icon: '🛠️' }
              ].map(t => (
                <div key={t.name} style={{ padding: '16px', borderRadius: '16px', border: '1px solid var(--border)', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>{t.icon}</div>
                  <div style={{ flex: 1, fontWeight: 'bold' }}>{t.name}</div>
                  <input type="checkbox" checked={draft.tools.includes(t.name)} onChange={(e) => {
                    const next = e.target.checked ? [...draft.tools, t.name] : draft.tools.filter(x => x !== t.name);
                    handleInputChange('tools', next);
                  }} style={{ width: '20px', height: '20px', accentColor: 'var(--accent)' }} />
                </div>
              ))}
            </div>
          </div>
        );
      case 3:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '28px' }}>Skills</h2>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
              <input placeholder="Search SkillsMP..." value={hubSearch} onChange={(e) => setHubSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '40px' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', maxHeight: '300px', overflowY: 'auto' }}>
              {hubResults.map(s => (
                <label key={s.id} style={{ 
                  padding: '16px', borderRadius: '12px', border: draft.skills.includes(s.name) ? '1px solid var(--accent)' : '1px solid var(--border)', 
                  background: draft.skills.includes(s.name) ? 'rgba(0, 122, 255, 0.05)' : 'var(--bg-input)', 
                  display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' 
                }}>
                  <input type="checkbox" checked={draft.skills.includes(s.name)} onChange={(e) => {
                    const next = e.target.checked ? [...draft.skills, s.name] : draft.skills.filter(x => x !== s.name);
                    handleInputChange('skills', next);
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{s.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>{s.description}</div>
                  </div>
                </label>
              ))}
              {hubResults.length === 0 && (
                <div style={{ gridColumn: 'span 2', padding: '20px', border: '1px dashed var(--border)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {hubSearch ? 'No skills found matching your search.' : 'Loading skills from hub...'}
                </div>
              )}
            </div>
          </div>
        );
      case 4:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '28px' }}>User Context</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Tell your agent about the user — context and preferences</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>YOUR NAME</label>
                <input 
                  value={draft.userProfile.name}
                  onChange={(e) => handleUserProfileChange('name', e.target.value)}
                  placeholder="e.g. Ryan" 
                  style={inputStyle} 
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>LANGUAGE</label>
                <input 
                  value={draft.userProfile.language}
                  onChange={(e) => handleUserProfileChange('language', e.target.value)}
                  placeholder="English" 
                  style={inputStyle} 
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>BACKGROUND</label>
              <textarea 
                value={draft.userProfile.background}
                onChange={(e) => handleUserProfileChange('background', e.target.value)}
                placeholder="Your work, projects, preferences..." 
                style={{ ...inputStyle, height: '120px', resize: 'none' }} 
              />
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', gap: '60px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '8px' }}>STEP {currentStep} OF 4</div>
          <div style={{ width: '100%', height: '4px', background: 'var(--bg-input)', borderRadius: '2px', marginBottom: '40px' }}>
            <div style={{ width: `${currentStep * 25}%`, height: '100%', background: '#34c759', borderRadius: '2px', transition: 'width 0.3s' }} />
          </div>
          <div style={{ flex: 1 }}>{renderStep()}</div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '40px' }}>
            <button 
              onClick={handleBack} 
              disabled={currentStep === 1 || isCreating} 
              style={{ padding: '12px 32px', borderRadius: '12px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', fontWeight: '600', cursor: isCreating ? 'not-allowed' : 'pointer', opacity: isCreating ? 0.5 : 1 }}
            >
              Back
            </button>
            <button 
              onClick={handleNext} 
              disabled={isCreating}
              style={{ padding: '12px 48px', borderRadius: '12px', background: '#34c759', color: '#fff', border: 'none', fontWeight: 'bold', cursor: isCreating ? 'wait' : 'pointer', marginLeft: 'auto' }}
            >
              {isCreating ? 'Generating Core Files...' : (currentStep === 4 ? 'Finish & Launch' : 'Next Step >')}
            </button>
          </div>
        </div>
        <div style={{ width: '320px' }}>
          <div style={{ position: 'sticky', top: '40px' }}>
            <LivePreview draft={draft} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentWizard;
