import { FSWatcher, watch } from 'fs';
import { readFile } from 'fs/promises';
import { EventEmitter } from 'events';
import * as path from 'path';
import { AgentConfig } from '../types/agent';

export class CoreFileLoader extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private agentConfig: AgentConfig;
  private agentPath: string;

  constructor(agentConfig: AgentConfig, agentPath: string) {
    super();
    this.agentConfig = agentConfig;
    this.agentPath = agentPath;
    this.initWatcher();
  }

  private initWatcher() {
    const corePath = path.join(this.agentPath, 'core');
    this.watcher = watch(corePath, { persistent: true }, (event, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log(`[CoreFileLoader] Change detected in ${filename}`);
        this.reloadBehavior(filename);
      }
    });
  }

  public async reloadBehavior(filename: string) {
    const filePath = path.join(this.agentPath, 'core', filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      const sections = this.parseMarkdown(content);
      
      // Update the Agent's behavior (injected into LLM system prompt)
      this.agentConfig.updatePrompt({ [filename]: content, ...sections });
      
      this.emit('RELOAD_COMPLETE', { filename, timestamp: Date.now() });
      console.log(`[CoreFileLoader] Successfully reloaded behavior for: ${filename}`);
    } catch (err) {
      console.error(`[CoreFileLoader] Failed to reload behavior for: ${filename}`, err);
      this.emit('RELOAD_ERROR', { filename, error: err });
    }
  }

  /**
   * Basic Markdown parser to split content by headers (e.g., # Personality)
   * into a key-value record for flexible prompt injection.
   */
  private parseMarkdown(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = content.split('\n');
    let currentHeader = 'General';
    let currentContent: string[] = [];

    for (const line of lines) {
      const match = line.match(/^#+\s+(.+)$/);
      if (match) {
        // Save previous section
        if (currentContent.length > 0) {
          sections[currentHeader] = currentContent.join('\n').trim();
        }
        currentHeader = match[1];
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // Final section
    if (currentContent.length > 0) {
      sections[currentHeader] = currentContent.join('\n').trim();
    }

    return sections;
  }

  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
