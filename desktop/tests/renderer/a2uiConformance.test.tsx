/**
 * A2UI v0.9.1 conformance fixture loop.
 *
 * For each JSON file in the specification examples directory:
 *   1. Feed the messages through a fresh MessageProcessor (with basicCatalog)
 *   2. Render each created surface via <A2uiSurfaceHost>
 *   3. Assert: no throw, non-empty DOM output
 *
 * Skips the entire describe block if /data/a2ui is not present on the host.
 * Design doc §6.2, acceptance criteria §task-4.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { basicCatalog, type ReactComponentImplementation } from '@a2ui/react/v0_9'
import { A2uiSurfaceHost } from '../../renderer/src/a2ui/A2uiSurfaceHost'
import type { AnchoredSurface } from '../../renderer/src/a2ui/A2uiSessionProcessor'

const FIXTURES_DIR = resolve('/data/a2ui/specification/v0_9_1/catalogs/basic/examples')

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Fixture shape
// Each fixture file is an object: { name, description, messages }
// where messages is an array of A2UI wire-protocol messages.
// ---------------------------------------------------------------------------

interface FixtureFile {
  name: string
  description?: string
  messages: unknown[]
}

function loadFixture(filePath: string): FixtureFile {
  const raw = readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  // Support both:
  //   { name, description, messages: [...] }  (most fixtures)
  //   [...] (bare array — none observed in practice but handle defensively)
  if (Array.isArray(parsed)) {
    return { name: filePath, messages: parsed }
  }
  return parsed as FixtureFile
}

// ---------------------------------------------------------------------------
// Run surfaces created by a processor through MessageProcessor.processMessages
// Returns AnchoredSurface[] (one per created surface).
// ---------------------------------------------------------------------------

function processFixture(messages: unknown[]): AnchoredSurface[] {
  const anchored: AnchoredSurface[] = []

  const processor = new MessageProcessor<ReactComponentImplementation>(
    [basicCatalog],
    (_action) => { /* no-op: action callbacks not needed for conformance */ },
  )

  const sub = processor.onSurfaceCreated((surface) => {
    anchored.push({
      surface,
      anchorMessageId: 'fixture-msg',
      toolUseId: 'fixture-tool',
      source: 'mcp',
    })
  })

  try {
    processor.processMessages(messages as Parameters<typeof processor.processMessages>[0])
  } finally {
    sub.unsubscribe()
  }

  return anchored
}

// ---------------------------------------------------------------------------
// Conformance suite
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync(FIXTURES_DIR))(
  'A2UI v0.9.1 conformance fixtures',
  () => {
    const fixtureFiles = existsSync(FIXTURES_DIR)
      ? readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json')).sort()
      : []

    it.each(fixtureFiles)(
      '%s: MessageProcessor + A2uiSurfaceHost renders without error and produces non-empty DOM',
      (filename) => {
        const filePath = resolve(FIXTURES_DIR, filename)
        const fixture = loadFixture(filePath)

        expect(
          Array.isArray(fixture.messages),
          `${filename}: fixture.messages should be an array`,
        ).toBe(true)
        expect(
          fixture.messages.length,
          `${filename}: fixture.messages should be non-empty`,
        ).toBeGreaterThan(0)

        // Process through MessageProcessor
        let surfaces: AnchoredSurface[] = []
        expect(
          () => { surfaces = processFixture(fixture.messages) },
          `${filename}: MessageProcessor.processMessages should not throw`,
        ).not.toThrow()

        expect(
          surfaces.length,
          `${filename}: at least one surface should be created`,
        ).toBeGreaterThan(0)

        // Render each surface
        for (const anchored of surfaces) {
          let renderResult: ReturnType<typeof render> | undefined
          expect(
            () => { renderResult = render(<A2uiSurfaceHost anchored={anchored} />) },
            `${filename}: surface "${anchored.surface.id}" should render without throw`,
          ).not.toThrow()

          // The rendered output must be non-empty (not just whitespace)
          const domText = renderResult?.container.innerHTML ?? ''
          expect(
            domText.trim().length,
            `${filename}: surface "${anchored.surface.id}" must produce non-empty DOM`,
          ).toBeGreaterThan(0)

          // Clean up between surfaces within the same fixture
          cleanup()
        }
      },
    )
  },
)
