import { CoreFileLoader } from './CoreFileLoader';
import { AgentConfig } from '../types/agent';

const mockAgentConfig: AgentConfig = {
  id: 'agent-1',
  name: 'Test Agent',
  description: 'A mock agent for testing.',
  vibe: 'Professional',
  avatar: 'Avatar-1',
  tools: [],
  skills: [],
  updatePrompt: (sections: Record<string, string>) => {
    console.log('[Test] Agent behavior updated with sections:', Object.keys(sections));
    for (const [key, value] of Object.entries(sections)) {
      console.log(`[Test] Section: [${key}] -> Content preview: ${value.slice(0, 50)}...`);
    }
  }
};

async function testLoader() {
  const loader = new CoreFileLoader(mockAgentConfig, '/tmp/mock_agent');
  
  // Simulated Markdown content
  const testContent = `
# Personality
Practical and solution-oriented.
# Tone
Brief and technical.
# Decision-making Logic
Focus on shipping working code.
  `;

  console.log('[Test] Parsing mock markdown content...');
  // @ts-ignore (Accessing private method for testing)
  const sections = loader.parseMarkdown(testContent);
  mockAgentConfig.updatePrompt(sections);
}

// testLoader();
console.log('[Test] CoreFileLoader is ready for testing.');
