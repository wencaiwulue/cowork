import { describe, expect, it } from 'vitest'
import {
  createPermissionResponse,
  normalizePermissionRequest,
} from '../main/permission'

const rawRequest = {
  type: 'control_request',
  request_id: 'request-1',
  request: {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    display_name: 'Run shell command',
    input: { command: 'git status' },
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        behavior: 'allow',
        destination: 'session',
      },
    ],
    blocked_path: '/tmp/project',
    decision_reason: 'Command may inspect workspace state',
    tool_use_id: 'toolu-1',
    description: 'Run git status',
  },
}

describe('permission request mapping', () => {
  it('normalizes real SDK can_use_tool control requests', () => {
    const request = normalizePermissionRequest({
      sessionId: 'session-1',
      message: rawRequest,
    })

    expect(request).toMatchObject({
      sessionId: 'session-1',
      requestId: 'request-1',
      toolName: 'Run shell command',
      description: 'Run git status',
      input: { command: 'git status' },
      toolUseId: 'toolu-1',
      blockedPath: '/tmp/project',
      decisionReason: 'Command may inspect workspace state',
      permissionSuggestions: expect.any(Array),
    })
  })

  it('extracts agent and team context for permission modals', () => {
    const request = normalizePermissionRequest({
      sessionId: 'session-1',
      message: {
        type: 'control_request',
        request_id: 'request-2',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: { command: 'npm test' },
          agent_context: {
            agent_type: 'reviewer',
            agent_id: 'agent-123',
            description: 'review the diff',
          },
          team_context: {
            team_name: 'frontend',
            teammate_name: 'alice',
            mode: 'plan',
          },
        },
      },
    })

    expect(request).toMatchObject({
      agentContext: 'Agent: reviewer · agent-123 · review the diff',
      teamContext: 'Team: frontend · @alice · plan',
    })
  })

  it('creates permission responses with tool use telemetry fields', () => {
    const request = normalizePermissionRequest({
      sessionId: 'session-1',
      message: rawRequest,
    })
    expect(request).not.toBeNull()

    expect(createPermissionResponse(request!, 'allow')).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'git status' },
      toolUseID: 'toolu-1',
      decisionClassification: 'user_temporary',
    })
    expect(createPermissionResponse(request!, 'deny')).toEqual({
      behavior: 'deny',
      message: 'User denied permission',
      toolUseID: 'toolu-1',
      decisionClassification: 'user_reject',
    })
  })

  it('ignores unsupported control request subtypes', () => {
    expect(
      normalizePermissionRequest({
        sessionId: 'session-1',
        message: {
          type: 'control_request',
          request_id: 'request-1',
          request: { subtype: 'set_permission_mode', mode: 'default' },
        },
      }),
    ).toBeNull()
  })
})
