import assert from 'node:assert';
import { MessageBus } from '../core/MessageBus.js';
import { CoreFileLoader } from '../core/CoreFileLoader.js';
import { WizardStore } from '../ui/WizardStore.js';
import { AgentConfig, AgentMessage, TaskStatus } from '../types/agent.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

async function testMessageBus() {
  console.log('Testing MessageBus...');
  const bus = MessageBus.getInstance();
  const testMessage: AgentMessage = {
    id: 'msg-1',
    sender_id: 'TL',
    receiver_id: 'ALL',
    type: 'TASK_ASSIGN',
    payload: { task_id: 'task-1', subject: 'Test', description: 'Test' },
    context_metadata: { conversation_id: 'conv-1' }
  };

  let receivedBroadcast = false;
  bus.on('broadcast', (msg) => {
    if (msg.id === 'msg-1') receivedBroadcast = true;
  });

  bus.publish(testMessage);
  assert.strictEqual(receivedBroadcast, true, 'Message should be broadcast');
  
  const history = bus.getMessageHistory('conv-1');
  assert.strictEqual(history.length, 1, 'History should contain 1 message');
  assert.strictEqual(history[0].id, 'msg-1');
  
  console.log('✓ MessageBus tests passed');
}

async function testCoreFileLoader() {
  console.log('Testing CoreFileLoader...');
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agent-test-'));
  const coreDir = path.join(tempDir, 'core');
  await fs.mkdir(coreDir);
  
  const soulPath = path.join(coreDir, 'SOUL.md');
  await fs.writeFile(soulPath, '# Personality\nInitial personality.');

  const mockConfig: AgentConfig = {
    id: 'agent-1',
    name: 'Test',
    description: '',
    vibe: '',
    avatar: '',
    tools: [],
    skills: [],
    updatePrompt: (sections) => {
      // @ts-ignore
      mockConfig._sections = sections;
    }
  };

  const loader = new CoreFileLoader(mockConfig, tempDir);
  
  // Wait for file system watcher to initialize
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('Modifying SOUL.md to trigger reload...');
  const newContent = '# Personality\nUpdated personality.\n# Tone\nTechnical.';
  await fs.writeFile(soulPath, newContent);

  // Wait for the reload to complete (it is async)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Reload timeout')), 2000);
    loader.on('RELOAD_COMPLETE', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });

  // @ts-ignore
  const sections = mockConfig._sections;
  assert.ok(sections, 'Sections should be updated');
  assert.strictEqual(sections['Personality'], 'Updated personality.', 'Personality section should match');
  assert.strictEqual(sections['Tone'], 'Technical.', 'Tone section should match');

  loader.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('✓ CoreFileLoader tests passed');
}

async function testWizardStore() {
  console.log('Testing WizardStore...');
  const store = WizardStore.getInstance();
  
  let draftUpdated = false;
  store.on('DRAFT_UPDATE', () => draftUpdated = true);
  
  store.updateDraft({ name: 'New Agent', vibe: 'Creative' });
  assert.strictEqual(draftUpdated, true, 'DRAFT_UPDATE event should be emitted');
  assert.strictEqual(store.getDraftAgent().name, 'New Agent');
  
  const success = store.finalize();
  assert.strictEqual(success, true, 'Finalization should succeed');
  assert.ok(store.getDraftAgent().id?.startsWith('agent-'), 'ID should be generated');
  
  console.log('✓ WizardStore tests passed');
}

async function runAll() {
  try {
    await testMessageBus();
    await testCoreFileLoader();
    await testWizardStore();
    console.log('\nAll preliminary verifications passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\nVerification failed:', err);
    process.exit(1);
  }
}

runAll();
