import { EventEmitter } from 'events';

export interface DraftAgent {
  id: string | null;
  name: string;
  description: string;
  vibe: string;
  avatar: string;
  tools: string[];
  skills: string[];
  llm: {
    base_url: string;
    api_key: string;
    model: string;
  };
  coreFiles: {
    'SOUL.md': string;
    'IDENTITY.md': string;
    'MEMORY.md': string;
    'AGENTS.md': string;
    'USERS.md': string;
  };
  userProfile: {
    name: string;
    language: string;
    background: string;
  };
}

export class WizardStore extends EventEmitter {
  private static instance: WizardStore;
  private currentStep: number = 1;
  private draftAgent: DraftAgent = {
    id: null,
    name: '',
    description: '',
    vibe: 'Professional',
    avatar: 'PixelArt-1',
    tools: [],
    skills: [],
    llm: {
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      model: 'gpt-4o'
    },
    coreFiles: {
      'SOUL.md': '# Personality\n\nPractical and solution-oriented.',
      'IDENTITY.md': '# Identity\n\n- Role: Senior Software Engineer\n- Vibe: Professional',
      'MEMORY.md': '# Memory\n\nLong-term curated knowledge.',
      'AGENTS.md': '',
      'USERS.md': ''
    },
    userProfile: {
      name: '',
      language: 'English',
      background: ''
    }
  };

  private constructor() {
    super();
  }

  public static getInstance(): WizardStore {
    if (!WizardStore.instance) {
      WizardStore.instance = new WizardStore();
    }
    return WizardStore.instance;
  }

  public updateDraft(patch: Partial<DraftAgent>) {
    this.draftAgent = { ...this.draftAgent, ...patch };
    this.emit('DRAFT_UPDATE', this.draftAgent);
  }

  public setStep(step: number) {
    this.currentStep = step;
    this.emit('STEP_UPDATE', this.currentStep);
  }

  public getDraftAgent(): Readonly<DraftAgent> {
    return this.draftAgent;
  }

  public getCurrentStep(): number {
    return this.currentStep;
  }

  public finalize(): boolean {
    if (!this.draftAgent.name || !this.draftAgent.vibe) {
      this.emit('ERROR', 'Name and Vibe are required to finalize.');
      return false;
    }
    this.draftAgent.id = `agent-${Date.now()}`;
    this.emit('FINALIZED', this.draftAgent);
    return true;
  }

  public reset() {
    this.currentStep = 1;
    this.draftAgent = {
      id: null,
      name: '',
      description: '',
      vibe: 'Professional',
      avatar: 'PixelArt-1',
      tools: [],
      skills: [],
      llm: {
        base_url: 'https://api.openai.com/v1',
        api_key: '',
        model: 'gpt-4o'
      },
      coreFiles: {
        'SOUL.md': '# Personality\n\nPractical and solution-oriented.',
        'IDENTITY.md': '# Identity\n\n- Role: Senior Software Engineer\n- Vibe: Professional',
        'MEMORY.md': '# Memory\n\nLong-term curated knowledge.',
        'AGENTS.md': '',
        'USERS.md': ''
      },
      userProfile: {
        name: '',
        language: 'English',
        background: ''
      }
    };
    this.emit('RESET');
  }
}
