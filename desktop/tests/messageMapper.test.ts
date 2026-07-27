import { describe, expect, it } from 'vitest'
import {
  extractAgentTaskUpdate,
  toDesktopMessage,
  toDesktopMessages,
  toStreamTextUpdate,
} from '../main/messageMapper'

describe('toDesktopMessage', () => {
  it('shows assistant text and thinking-only assistant chunks', () => {
    expect(
      toDesktopMessage({
        type: 'assistant',
        uuid: 'assistant-text',
        message: {
          content: [{ type: 'text', text: 'Ready.' }],
        },
      }),
    ).toMatchObject({
      id: 'assistant-text',
      role: 'assistant',
      text: 'Ready.',
    })

    expect(
      toDesktopMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'hidden reasoning' }],
        },
      }),
    ).toMatchObject({
      role: 'thinking',
      text: 'hidden reasoning',
    })

    expect(
      toDesktopMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'redacted_thinking', data: 'sealed' }],
        },
      }),
    ).toMatchObject({
      role: 'thinking',
      text: '[redacted thinking block]',
    })
  })

  it('splits mixed assistant thinking and text into ordered visible messages', () => {
    expect(toDesktopMessages({
      type: 'assistant',
      uuid: 'assistant-mixed',
      message: {
        content: [
          { type: 'thinking', thinking: 'checking context' },
          { type: 'text', text: 'Ready.' },
        ],
      },
    })).toMatchObject([
      {
        id: 'assistant-mixed:thinking',
        role: 'thinking',
        text: 'checking context',
      },
      {
        id: 'assistant-mixed',
        role: 'assistant',
        text: 'Ready.',
      },
    ])
  })

  it('filters noisy stream-json control and hook events', () => {
    for (const raw of [
      { type: 'keep_alive' },
      { type: 'control_response' },
      { type: 'control_cancel_request' },
      { type: 'system', subtype: 'init' },
      { type: 'system', subtype: 'hook_started' },
      { type: 'system', subtype: 'hook_response', output: 'very large hook payload' },
      { type: 'system', subtype: 'post_turn_summary' },
      { type: 'system', subtype: 'status', message: 'Working...' },
      { type: 'system', subtype: 'task_started' },
      { type: 'system', subtype: 'task_progress' },
      { type: 'system', subtype: 'task_notification' },
      { type: 'system', subtype: 'files_persisted' },
      { type: 'system', subtype: 'api_retry' },
      { type: 'system', subtype: 'compact_boundary' },
      { type: 'system', subtype: 'future_runtime_status', message: 'internal progress' },
      { type: 'system', message: 'internal update' },
    ]) {
      expect(toDesktopMessage(raw)).toBeNull()
    }
  })

  it('maps streamlined text and text deltas for streaming display', () => {
    expect(toDesktopMessage({
      type: 'streamlined_text',
      uuid: 'streamlined-1',
      text: 'streamlined output',
    })).toMatchObject({
      id: 'streamlined-1',
      role: 'assistant',
      text: 'streamlined output',
    })

    expect(toStreamTextUpdate({
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        index: 2,
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'partial' },
      },
    })).toMatchObject({
      id: 'delta-1',
      streamKey: '2',
      mode: 'delta',
      role: 'assistant',
      text: 'partial',
    })

    expect(toStreamTextUpdate({
      type: 'stream_event',
      uuid: 'thinking-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'checking context' },
      },
    })).toMatchObject({
      id: 'thinking-1',
      mode: 'delta',
      role: 'thinking',
      text: 'checking context',
    })

    expect(toStreamTextUpdate({
      type: 'content_block_delta',
      uuid: 'direct-thinking-1',
      delta: { type: 'thinking_delta', thinking: 'direct context' },
    })).toMatchObject({
      id: 'direct-thinking-1',
      mode: 'delta',
      role: 'thinking',
      text: 'direct context',
    })

    expect(toStreamTextUpdate({
      type: 'content_block_delta',
      uuid: 'direct-text-1',
      delta: { type: 'text_delta', text: 'direct partial' },
    })).toMatchObject({
      id: 'direct-text-1',
      mode: 'delta',
      role: 'assistant',
      text: 'direct partial',
    })

    expect(toStreamTextUpdate({
      type: 'streamlined_text',
      uuid: 'snapshot-1',
      text: 'full so far',
    })).toMatchObject({
      id: 'snapshot-1',
      mode: 'snapshot',
      role: 'assistant',
      text: 'full so far',
    })
  })

  it('maps thinking block starts without treating duplicated text starts as content', () => {
    expect(toStreamTextUpdate({
      type: 'stream_event',
      uuid: 'thinking-start',
      event: {
        type: 'content_block_start',
        content_block: { type: 'thinking', thinking: 'duplicate-prone seed' },
      },
    })).toMatchObject({
      id: 'thinking-start',
      mode: 'snapshot',
      role: 'thinking',
      text: '',
    })

    expect(toStreamTextUpdate({
      type: 'stream_event',
      uuid: 'redacted-start',
      event: {
        type: 'content_block_start',
        content_block: { type: 'redacted_thinking', data: 'sealed' },
      },
    })).toMatchObject({
      id: 'redacted-start',
      mode: 'snapshot',
      role: 'thinking',
      text: '[redacted thinking block]',
    })

    expect(toStreamTextUpdate({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'text', text: 'may be repeated by delta' },
      },
    })).toBeNull()
  })

  it('maps streamed tool-use starts into visible tool activity', () => {
    expect(toDesktopMessage({
      type: 'stream_event',
      uuid: 'tool-start-1',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'toolu-1',
          name: 'Bash',
        },
      },
    })).toMatchObject({
      id: 'toolu-1',
      role: 'tool',
      text: 'Using Bash...',
    })

    expect(toDesktopMessage({
      type: 'stream_event',
      uuid: 'server-tool-start-1',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'server_tool_use',
          id: 'srvu-1',
          name: 'web_search',
        },
      },
    })).toMatchObject({
      id: 'srvu-1',
      role: 'tool',
      text: 'Using web_search...',
    })
  })

  it('does not render runtime tool results as user chat messages', () => {
    expect(toDesktopMessage({
      type: 'user',
      uuid: 'tool-result-user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu-1',
          content: 'tool output should not appear as a user prompt',
        }],
      },
    })).toBeNull()
  })
})

describe('extractAgentTaskUpdate', () => {
  it('parses Agent, task, message, and team tool-use blocks', () => {
    expect(extractAgentTaskUpdate({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-agent',
          name: 'Agent',
          input: {
            subagent_type: 'reviewer',
            description: 'review diff',
          },
        }],
      },
    })).toMatchObject({
      id: 'toolu-agent',
      toolUseId: 'toolu-agent',
      agentType: 'reviewer',
      description: 'review diff',
      status: 'pending',
      lastToolName: 'Agent',
      toolTimeline: [{
        id: 'toolu-agent:started',
        toolName: 'Agent',
        status: 'started',
        summary: 'review diff',
      }],
    })

    expect(extractAgentTaskUpdate({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-output',
          name: 'TaskOutput',
          input: { task_id: 'agent-123', block: false },
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-output',
      status: 'running',
      lastToolName: 'TaskOutput',
      toolTimeline: [{
        id: 'toolu-output:started',
        toolName: 'TaskOutput',
        status: 'started',
        summary: 'agent-123',
      }],
    })

    expect(extractAgentTaskUpdate({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-stop',
          name: 'TaskStop',
          input: { task_id: 'agent-123' },
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-stop',
      lastToolName: 'TaskStop',
    })

    expect(extractAgentTaskUpdate({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-send',
          name: 'SendMessage',
          input: { to: 'agent-123', message: 'continue' },
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-send',
      lastToolName: 'SendMessage',
    })

    expect(extractAgentTaskUpdate({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-team-create',
          name: 'TeamCreate',
          input: { team_name: 'frontend', description: 'UI work' },
        }],
      },
    })).toMatchObject({
      id: 'frontend',
      toolUseId: 'toolu-team-create',
      description: 'frontend',
      status: 'running',
      lastToolName: 'TeamCreate',
      toolTimeline: [{
        id: 'toolu-team-create:started',
        toolName: 'TeamCreate',
        status: 'started',
        summary: 'UI work',
      }],
    })

    expect(extractAgentTaskUpdate({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-team-delete',
          name: 'TeamDelete',
          input: {},
        }],
      },
    })).toMatchObject({
      id: 'toolu-team-delete',
      toolUseId: 'toolu-team-delete',
      status: 'running',
      lastToolName: 'TeamDelete',
    })
  })

  it('parses Agent tool JSON launch and completion results', () => {
    expect(extractAgentTaskUpdate({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu-agent',
          content: JSON.stringify({
            status: 'async_launched',
            agentId: 'agent-123',
            subagent_type: 'reviewer',
            description: 'review diff',
            outputFile: '/tmp/out.txt',
            totalTokens: 1234,
            totalDurationMs: 3000,
          }),
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-agent',
      agentType: 'reviewer',
      description: 'review diff',
      status: 'running',
      outputFile: '/tmp/out.txt',
      tokenCount: 1234,
      durationMs: 3000,
      toolTimeline: [{
        id: 'toolu-agent:completed',
        toolName: 'Agent',
        status: 'completed',
        summary: 'async_launched',
      }],
    })

    expect(extractAgentTaskUpdate({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'completed',
              taskId: 'agent-123',
              result: 'done',
            }),
          }],
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      status: 'completed',
      result: 'done',
    })
  })

  it('parses task control tool results', () => {
    expect(extractAgentTaskUpdate({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu-output',
          content: JSON.stringify({
            retrieval_status: 'success',
            task: {
              task_id: 'agent-123',
              task_type: 'local_agent',
              status: 'completed',
              description: 'review diff',
              output: 'final output',
              result: 'final result',
            },
          }),
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-output',
      status: 'completed',
      lastToolName: 'TaskOutput',
      outputPreview: 'final output',
      result: 'final result',
      toolTimeline: [{
        id: 'toolu-output:completed',
        toolName: 'TaskOutput',
        status: 'completed',
        summary: 'final result',
      }],
    })

    expect(extractAgentTaskUpdate({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu-stop',
          content: JSON.stringify({
            message: 'Successfully stopped task: agent-123',
            task_id: 'agent-123',
            task_type: 'local_agent',
          }),
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-stop',
      status: 'cancelled',
      lastToolName: 'TaskStop',
    })

    expect(extractAgentTaskUpdate({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu-send',
          content: JSON.stringify({
            success: true,
            target: 'agent-123',
            message: 'Message queued',
          }),
        }],
      },
    })).toMatchObject({
      id: 'agent-123',
      toolUseId: 'toolu-send',
      status: 'running',
      lastToolName: 'SendMessage',
      result: 'Message queued',
    })
  })

  it('parses background task notification XML', () => {
    expect(extractAgentTaskUpdate({
      type: 'result',
      result: [
        '<task_notification>',
        '<task_id>task-1</task_id>',
        '<status>failed</status>',
        '<summary>tests failed</summary>',
        '<output_file>/tmp/task.md</output_file>',
        '<worktree_path>/tmp/worktree</worktree_path>',
        '<usage><total_tokens>42</total_tokens><tool_uses>3</tool_uses><duration_ms>9000</duration_ms></usage>',
        '</task_notification>',
      ].join(''),
    })).toMatchObject({
      id: 'task-1',
      status: 'failed',
      description: 'tests failed',
      outputFile: '/tmp/task.md',
      worktreePath: '/tmp/worktree',
      tokenCount: 42,
      toolUseCount: 3,
      durationMs: 9000,
    })
  })
})
