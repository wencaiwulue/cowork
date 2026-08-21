/**
 * Node-environment tests for the A2UI protocol layer (Phase 1).
 *
 * Design doc reference: docs/design/2026-08-21-a2ui-integration.md §6.1
 *
 * Coverage:
 *   - isA2uiResource() true/false cases including mimeType with parameters
 *     and a2ui:// URI scheme
 *   - parseA2uiMessages() for valid arrays, lone object (leniency wrap), invalid
 *     JSON, non-array JSON, arrays of non-objects
 *   - validateA2uiMessages() against real fixtures from the specification
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isA2uiResource,
  parseA2uiMessages,
  A2UI_MIME_TYPE,
} from '../../src/a2ui/protocol.js'
import { validateA2uiMessages } from '../../src/a2ui/validate.js'

// ---------------------------------------------------------------------------
// isA2uiResource
// ---------------------------------------------------------------------------

describe('isA2uiResource()', () => {
  it('returns true for exact mimeType match', () => {
    expect(isA2uiResource({ mimeType: A2UI_MIME_TYPE })).toBe(true)
  })

  it('returns true for mimeType with parameters', () => {
    expect(
      isA2uiResource({ mimeType: 'application/a2ui+json; charset=utf-8' }),
    ).toBe(true)
  })

  it('returns true for a2ui:// URI scheme regardless of mimeType', () => {
    expect(isA2uiResource({ uri: 'a2ui://my-surface/12345' })).toBe(true)
  })

  it('returns true when both mimeType and a2ui:// uri are present', () => {
    expect(
      isA2uiResource({
        uri: 'a2ui://surface',
        mimeType: 'application/a2ui+json',
      }),
    ).toBe(true)
  })

  it('returns false for a different mimeType', () => {
    expect(isA2uiResource({ mimeType: 'application/json' })).toBe(false)
  })

  it('returns false for non-a2ui URI with no mimeType', () => {
    expect(isA2uiResource({ uri: 'https://example.com/resource' })).toBe(false)
  })

  it('returns false for empty object', () => {
    expect(isA2uiResource({})).toBe(false)
  })

  it('returns false when mimeType is only a prefix of the A2UI type', () => {
    expect(isA2uiResource({ mimeType: 'application/a2ui' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseA2uiMessages
// ---------------------------------------------------------------------------

describe('parseA2uiMessages()', () => {
  const validCreateSurface = {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'test-surface',
      catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    },
  }

  const validUpdateComponents = {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'test-surface',
      components: [{ id: 'root', component: 'Text', text: 'Hello' }],
    },
  }

  it('returns parsed array for valid JSON array input', () => {
    const input = JSON.stringify([validCreateSurface, validUpdateComponents])
    const result = parseA2uiMessages(input)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect((result![0] as any).createSurface.surfaceId).toBe('test-surface')
  })

  it('wraps a lone valid object into a one-element array (leniency for real servers)', () => {
    const input = JSON.stringify(validCreateSurface)
    const result = parseA2uiMessages(input)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
  })

  it('returns null for invalid JSON', () => {
    expect(parseA2uiMessages('{ not valid json }')).toBeNull()
  })

  it('returns null for a non-array top-level JSON value (string)', () => {
    expect(parseA2uiMessages('"just a string"')).toBeNull()
  })

  it('returns null for a non-array top-level JSON value (number)', () => {
    expect(parseA2uiMessages('42')).toBeNull()
  })

  it('returns null for null JSON', () => {
    expect(parseA2uiMessages('null')).toBeNull()
  })

  it('returns null for an array whose elements are not objects', () => {
    expect(parseA2uiMessages('["string", 42, true]')).toBeNull()
  })

  it('returns null for an array containing a null element', () => {
    expect(parseA2uiMessages('[null]')).toBeNull()
  })

  it('returns null for an array containing a nested array', () => {
    expect(parseA2uiMessages('[[]]')).toBeNull()
  })

  it('preserves version field in parsed messages', () => {
    const msg = { version: 'v0.9.1', deleteSurface: { surfaceId: 's1' } }
    const result = parseA2uiMessages(JSON.stringify([msg]))
    expect(result).not.toBeNull()
    expect((result![0] as any).version).toBe('v0.9.1')
  })
})

// ---------------------------------------------------------------------------
// validateA2uiMessages — fixture-based tests
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve('/data/a2ui/specification/v0_9_1/catalogs/basic/examples')

describe.skipIf(!existsSync(FIXTURES_DIR))(
  'validateA2uiMessages() — fixture tests',
  () => {
    function loadFixtureMessages(filename: string): unknown[] {
      const raw = JSON.parse(
        readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8'),
      )
      // Fixtures wrap messages in { name, description, messages: [...] }
      if (Array.isArray(raw)) return raw
      if (raw && Array.isArray(raw.messages)) return raw.messages
      throw new Error(`Unexpected fixture shape in ${filename}`)
    }

    it('00_simple-text.json — validates as correct', async () => {
      const messages = loadFixtureMessages('00_simple-text.json')
      const result = await validateA2uiMessages(messages)
      // If AJV is unavailable the function returns { valid: false } with
      // a diagnostic; skip the fixture assertion in that case
      if (result.errors.some(e => e.startsWith('Validator unavailable'))) {
        return
      }
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('00_interactive-button.json — validates as correct', async () => {
      const messages = loadFixtureMessages('00_interactive-button.json')
      const result = await validateA2uiMessages(messages)
      if (result.errors.some(e => e.startsWith('Validator unavailable'))) return
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('36_modal.json — validates as correct', async () => {
      const messages = loadFixtureMessages('36_modal.json')
      const result = await validateA2uiMessages(messages)
      if (result.errors.some(e => e.startsWith('Validator unavailable'))) return
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects an obviously malformed message (missing required fields)', async () => {
      const malformed = [
        // A createSurface message missing the required 'catalogId' field
        { version: 'v0.9', createSurface: { surfaceId: 'bad' } },
      ]
      const result = await validateA2uiMessages(malformed as unknown[])
      if (result.errors.some(e => e.startsWith('Validator unavailable'))) return
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('rejects a message with an unknown type key', async () => {
      const unknown = [
        { version: 'v0.9', unknownMessageType: { surfaceId: 'x' } },
      ]
      const result = await validateA2uiMessages(unknown as unknown[])
      if (result.errors.some(e => e.startsWith('Validator unavailable'))) return
      expect(result.valid).toBe(false)
    })
  },
)
