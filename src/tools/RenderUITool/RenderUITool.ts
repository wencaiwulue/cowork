/**
 * RenderUI — built-in tool that emits A2UI v0.9.1 surfaces into the chat
 * transcript and suspends the CLI turn until the user interacts.
 *
 * Design doc reference: docs/design/2026-08-21-a2ui-integration.md §5.1/§5.2
 *
 * Pattern reference: src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx
 *   - shouldDefer: true (turn suspends, desktop writes tool_result via stdin)
 *   - requiresUserInteraction(): true (skipped in non-interactive environments)
 *   - isEnabled(): feature-flagged, desktop-only
 */

import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { validateA2uiMessages } from '../../a2ui/validate.js'
import { RENDER_UI_TOOL_DESCRIPTION, RENDER_UI_TOOL_NAME, RENDER_UI_TOOL_PROMPT } from './prompt.js'

// ---------------------------------------------------------------------------
// Zod schema — messages field uses z.array(z.unknown()) at the zod layer.
// Deep A2UI validation is delegated to the AJV-based validateA2uiMessages()
// so we avoid generating an enormous zod schema from the catalog JSON.
// See design doc §5.2: "messages field is z.array(z.unknown()) at the zod
// level because deep A2UI schema validation is delegated to AJV."
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  messages: z.array(z.unknown()).min(1).describe(
    'Array of A2UI v0.9.1 messages (createSurface + updateComponents + optional updateDataModel). ' +
    'The root component MUST be the first element in the components list. ' +
    'Parents must precede children.',
  ),
})

type InputSchema = typeof inputSchema

// Output is whatever comes back as the tool_result (the A2UI action payload
// serialised as a JSON string by the desktop, then returned here as a string).
type Output = { result: string }

export const RenderUITool: Tool<InputSchema, Output> = buildTool({
  name: RENDER_UI_TOOL_NAME,
  searchHint: 'render an interactive A2UI surface inline in the conversation',
  maxResultSizeChars: 100_000,
  shouldDefer: true,

  async description() {
    return RENDER_UI_TOOL_DESCRIPTION
  },

  async prompt() {
    return RENDER_UI_TOOL_PROMPT
  },

  get inputSchema(): InputSchema {
    return inputSchema
  },

  userFacingName() {
    return 'Rendering UI surface…'
  },

  /**
   * Gate: feature flag A2UI_RENDER_UI must be on AND the runtime must be
   * the desktop (CLAUDE_CODE_ENTRYPOINT=claude-desktop).
   *
   * Using the same pattern as other feature-flagged tools in tools.ts:
   *   feature('FLAG_NAME') from 'bun:bundle' for build-time dead-code
   *   elimination, with a runtime check for the desktop entrypoint.
   *
   * Default OFF — callers that explicitly enable A2UI_RENDER_UI at build time
   * AND run inside the desktop will get this tool. All other environments
   * (CLI, SDK, channels) return false so shouldDefer never fires there.
   */
  isEnabled(): boolean {
    if (!feature('A2UI_RENDER_UI')) return false
    // Desktop entrypoint sets CLAUDE_CODE_ENTRYPOINT=claude-desktop.
    // In any other runtime (headless CLI, SDK, channels) this tool must be
    // disabled because there is no UI to render into.
    const entrypoint = Function('return process.env')().CLAUDE_CODE_ENTRYPOINT as string | undefined
    if (entrypoint !== 'claude-desktop') return false
    return true
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly() {
    return true
  },

  requiresUserInteraction() {
    return true
  },

  /**
   * Validate input: run AJV-based A2UI schema validation on the messages array.
   * Surfaces descriptive errors back to the model so it can self-correct.
   */
  async validateInput({ messages }) {
    const result = await validateA2uiMessages(messages)
    if (result.valid) return { result: true }
    const errorText = result.errors.slice(0, 10).join('; ')
    return {
      result: false,
      message:
        `A2UI validation failed (${result.errors.length} error(s)): ${errorText}. ` +
        'Ensure createSurface is first, the component with id "root" is first in the components list, ' +
        'and all referenced catalogId URLs are correct.',
      errorCode: 1,
    }
  },

  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      message: 'Render UI surface?',
      updatedInput: input,
    }
  },

  renderToolUseMessage() {
    return null
  },

  renderToolUseProgressMessage() {
    return null
  },

  renderToolResultMessage() {
    return null
  },

  renderToolUseRejectedMessage() {
    return null
  },

  renderToolUseErrorMessage() {
    return null
  },

  /**
   * The tool call always returns data immediately — the actual content is
   * whatever the desktop injected as the tool_result (the user's action).
   * Under shouldDefer the desktop writes the tool_result to CLI stdin and
   * the framework calls this function with the injected data already present
   * in the input (populated by the permission component / host.submitA2uiAction).
   */
  async call(input, _context) {
    // The action payload arrives via the desktop writing a tool_result to stdin.
    // We return it as a string for the model to reason about.
    return {
      data: {
        result: JSON.stringify(input),
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      content: output.result,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
