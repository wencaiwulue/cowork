/**
 * A2UI emitter prompt builder.
 *
 * Provides:
 *   buildA2uiSchemaBlock(componentNames?)  — emits a pruned ---BEGIN/END--- block
 *   getA2uiWorkflowRules()                — DEFAULT_WORKFLOW_RULES from the Python SDK
 *
 * Design doc reference: docs/design/2026-08-21-a2ui-integration.md §5.1
 * Risk R4: token cost — callers should pass componentNames to prune the block
 * to ~1k tokens instead of the ~4-8k full catalog.
 *
 * Ported from Python SDK:
 *   /data/a2ui/agent_sdks/python/a2ui_agent/src/a2ui/schema/constants.py:98-108
 *   /data/a2ui/agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:342-367
 */

import serverToClientSchema from './schemas/server_to_client.json' assert { type: 'json' }
import commonTypesSchema from './schemas/common_types.json' assert { type: 'json' }
import catalogSchema from './schemas/catalogs/basic/catalog.json' assert { type: 'json' }

// ---------------------------------------------------------------------------
// DEFAULT_WORKFLOW_RULES — ported verbatim from Python SDK constants.py:98-108
// ---------------------------------------------------------------------------

const A2UI_OPEN_TAG = '<a2ui-json>'
const A2UI_CLOSE_TAG = '</a2ui-json>'

/**
 * Returns the DEFAULT_WORKFLOW_RULES string (ported from Python SDK).
 * These are injected as a system message fragment when RenderUI is enabled.
 */
export function getA2uiWorkflowRules(): string {
  return `
The generated response MUST follow these rules:
- The response can contain one or more A2UI JSON blocks.
- Each A2UI JSON block MUST be wrapped in \`${A2UI_OPEN_TAG}\` and \`${A2UI_CLOSE_TAG}\` tags.
- Between or around these blocks, you can provide conversational text.
- The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
- Top-Down Component Ordering: Within the \`components\` list of a message:
    - The 'root' component MUST be the FIRST element.
    - Parent components MUST appear before their child components.
    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives.
`.trim()
}

// ---------------------------------------------------------------------------
// buildA2uiSchemaBlock — ported from catalog.py render_as_llm_instructions()
// ---------------------------------------------------------------------------

const SCHEMA_BLOCK_START = '---BEGIN A2UI JSON SCHEMA---'
const SCHEMA_BLOCK_END = '---END A2UI JSON SCHEMA---'

/**
 * Returns the ---BEGIN A2UI JSON SCHEMA--- block used in RenderUI tool prompt.
 *
 * Accepts an optional allowlist of component names to prune the catalog to only
 * the listed components, so callers can inject ~1k tokens instead of ~4-8k.
 *
 * All known component names (from the basic catalog):
 *   Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs,
 *   Modal, Divider, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput
 *
 * Example — inject only card + button schema (~1k tokens):
 *   buildA2uiSchemaBlock(['Card', 'Button', 'Text'])
 */
export function buildA2uiSchemaBlock(componentNames?: string[]): string {
  const parts: string[] = [SCHEMA_BLOCK_START]

  // Server-to-client schema (always included — defines message envelope types)
  const s2cStr = JSON.stringify(serverToClientSchema, null, 0)
  parts.push(`### Server To Client Schema:\n${s2cStr}`)

  // Common types schema — include only when it has $defs (always true for v0_9_1)
  const ct = commonTypesSchema as Record<string, unknown>
  if (ct.$defs && typeof ct.$defs === 'object' && Object.keys(ct.$defs as object).length > 0) {
    const ctStr = JSON.stringify(commonTypesSchema, null, 0)
    parts.push(`### Common Types Schema:\n${ctStr}`)
  }

  // Catalog schema — prune to allowlisted components when provided
  const catalog = catalogSchema as {
    $schema?: string
    $id?: string
    title?: string
    description?: string
    catalogId?: string
    components?: Record<string, unknown>
    functions?: unknown
    $defs?: unknown
  }

  let prunedCatalog: typeof catalog
  if (componentNames && componentNames.length > 0) {
    const allowSet = new Set(componentNames)
    const prunedComponents: Record<string, unknown> = {}
    for (const [name, def] of Object.entries(catalog.components ?? {})) {
      if (allowSet.has(name)) {
        prunedComponents[name] = def
      }
    }
    prunedCatalog = {
      ...catalog,
      components: prunedComponents,
    }
  } else {
    prunedCatalog = catalog
  }

  const catalogStr = JSON.stringify(prunedCatalog, null, 0)
  parts.push(`### Catalog Schema:\n${catalogStr}`)

  parts.push(SCHEMA_BLOCK_END)

  return parts.join('\n\n')
}
