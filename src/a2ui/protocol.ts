/**
 * A2UI v0.9.1 protocol types and helpers for the Claude Code CLI.
 *
 * This module defines the wire-format types for A2UI messages (agent→renderer)
 * and provides utility functions for detecting and parsing A2UI payloads that
 * arrive as MCP EmbeddedResource content.
 *
 * Design doc reference: docs/design/2026-08-21-a2ui-integration.md §5.1
 */

export const A2UI_MIME_TYPE = 'application/a2ui+json' as const

// ---------------------------------------------------------------------------
// A2UI v0.9.1 wire-format message union (server → renderer / agent → renderer)
// ---------------------------------------------------------------------------

/** A2UI v0.9.1 wire-format message union (agent→renderer). */
export type A2uiMessage =
  | { version: 'v0.9' | 'v0.9.1'; createSurface: CreateSurface }
  | { version: 'v0.9' | 'v0.9.1'; updateComponents: UpdateComponents }
  | { version: 'v0.9' | 'v0.9.1'; updateDataModel: UpdateDataModel }
  | { version: 'v0.9' | 'v0.9.1'; deleteSurface: DeleteSurface }

export interface CreateSurface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  sendDataModel?: boolean
}

export interface UpdateComponents {
  surfaceId: string
  components: A2uiComponent[]
}

export interface UpdateDataModel {
  surfaceId: string
  /** JSON Pointer; omitted means '/' */
  path?: string
  /** omitted = delete the key at path */
  value?: unknown
}

export interface DeleteSurface {
  surfaceId: string
}

export interface A2uiComponent {
  id: string
  component?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Client → agent payloads (actions and errors from the renderer)
// ---------------------------------------------------------------------------

/** A2UI v0.9.1 client→agent action payload (all five fields required). */
export interface A2uiActionPayload {
  version: 'v0.9' | 'v0.9.1'
  action: {
    name: string
    surfaceId: string
    sourceComponentId: string
    /** ISO 8601 */
    timestamp: string
    context: Record<string, unknown>
  }
}

/** A2UI v0.9.1 client→agent error payload. */
export interface A2uiErrorPayload {
  version: 'v0.9' | 'v0.9.1'
  error: {
    code: string
    surfaceId: string
    message: string
    /** JSON Pointer, required when code === 'VALIDATION_FAILED' */
    path?: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the MCP resource content is an A2UI payload.
 * Checks both mimeType and uri scheme so callers are tolerant of missing fields.
 *
 * Accepts a mimeType with parameters (e.g. 'application/a2ui+json; charset=utf-8')
 * and treats a uri with the 'a2ui://' scheme as a positive signal even without a
 * matching mimeType.
 */
export function isA2uiResource(resource: {
  uri?: string
  mimeType?: string
}): boolean {
  if (resource.mimeType) {
    // Strip parameters before comparing (e.g. 'application/a2ui+json; charset=utf-8')
    const baseType = resource.mimeType.split(';')[0]?.trim()
    if (baseType === A2UI_MIME_TYPE) {
      return true
    }
  }
  if (resource.uri?.startsWith('a2ui://')) {
    return true
  }
  return false
}

/**
 * Parses the text field of an A2UI EmbeddedResource.
 *
 * Returns the parsed message array, or null if:
 *   - text is not valid JSON
 *   - the top-level value is not an array
 *   - an element in the array is not an object
 *
 * NOTE: The MCP binding specifies that the `text` field carries a JSON *array*.
 * However, real-world servers occasionally send a single bare object. We are
 * lenient here and wrap a lone valid message object into a one-element array
 * because breaking real server output is worse than being slightly over-permissive.
 */
export function parseA2uiMessages(text: string): A2uiMessage[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  // If a single object is sent (non-spec but real servers do this), wrap it.
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed)
  ) {
    parsed = [parsed]
  }

  if (!Array.isArray(parsed)) {
    return null
  }

  // Validate that each element is an object (non-null).
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return null
    }
  }

  return parsed as A2uiMessage[]
}
