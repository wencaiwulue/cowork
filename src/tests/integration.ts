import assert from 'node:assert';
import { WizardStore, DraftAgent } from '../ui/WizardStore.js';
import { EventEmitter } from 'events';

/**
 * Mocking the behavior of AgentWizard component logic
 * to verify integration with WizardStore.
 */
class MockAgentWizard {
  public currentStep: number;
  public draft: DraftAgent;
  private store = WizardStore.getInstance();

  constructor() {
    this.currentStep = this.store.getCurrentStep();
    this.draft = this.store.getDraftAgent();
    
    // Simulating useEffect subscriptions
    this.store.on('STEP_UPDATE', (step) => {
      this.currentStep = step;
    });
    this.store.on('DRAFT_UPDATE', (updatedDraft) => {
      this.draft = updatedDraft;
    });
  }

  public inputName(name: string) {
    this.store.updateDraft({ name });
  }

  public nextStep() {
    this.store.setStep(this.currentStep + 1);
  }

  public finalize() {
    return this.store.finalize();
  }
}

async function testWizardIntegration() {
  console.log('Testing Wizard Integration (UI Logic -> Store)...');
  const wizard = new MockAgentWizard();
  const store = WizardStore.getInstance();

  // Initial state check
  assert.strictEqual(wizard.currentStep, 1);
  assert.strictEqual(wizard.draft.name, '');

  // 1. Simulate user typing name
  console.log('Simulating user typing name...');
  wizard.inputName('Architect Agent');
  assert.strictEqual(wizard.draft.name, 'Architect Agent', 'Component state should sync with store');
  assert.strictEqual(store.getDraftAgent().name, 'Architect Agent', 'Store should be updated');

  // 2. Simulate next step
  console.log('Simulating next step transition...');
  wizard.nextStep();
  assert.strictEqual(wizard.currentStep, 2, 'Component step should sync with store');
  assert.strictEqual(store.getCurrentStep(), 2, 'Store step should be updated');

  // 3. Finalize
  console.log('Simulating finalization...');
  store.setStep(4); // Jump to last step
  const success = wizard.finalize();
  assert.strictEqual(success, true, 'Finalization should succeed with name provided');
  assert.ok(wizard.draft.id?.startsWith('agent-'), 'Finalized draft should have an ID');

  console.log('✓ Wizard Integration tests passed');
}

async function runIntegration() {
  try {
    await testWizardIntegration();
    console.log('\nIntegration verification passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\nIntegration verification failed:', err);
    process.exit(1);
  }
}

runIntegration();
