#!/usr/bin/env node
/**
 * Self-test for scripts/verify-request-shape.mjs.
 *
 * A shape checker that always passes is worse than no checker, so this feeds it
 * both a sanitized request and a pre-patch Claude Code one and requires that it
 * accepts the first and rejects every aspect of the second.
 *
 *   node tests/verify-request-shape.test.mjs
 */
import assert from 'node:assert/strict'
import { checkRequest } from '../scripts/verify-request-shape.mjs'

const sanitized = {
  headers: {
    'user-agent': 'anthropic-sdk-typescript/0.71.0',
    'anthropic-beta': 'oauth-2025-04-20,interleaved-thinking-2025-05-14,effort-2025-11-24',
    'anthropic-version': '2023-06-01',
    'x-api-key': 'sk-test',
    'content-type': 'application/json',
  },
  body: {
    system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] },
    ],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    metadata: {},
  },
}

const prePatch = {
  headers: {
    'user-agent': 'claude-cli/2.1.0 (ant, cli)',
    'x-app': 'cli',
    'x-claude-code-session-id': 'session-abc',
    'x-client-app': 'my-app/1.0.0',
    'x-client-request-id': 'req-1',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'MacOS',
    'anthropic-beta': 'claude-code-20250219,cli-internal-2026-02-09,oauth-2025-04-20',
  },
  body: {
    system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', scope: 'global' } }],
    thinking: { type: 'enabled', budget_tokens: 10000 },
    metadata: { user_id: '{"device_id":"d","session_id":"s"}' },
  },
}

const clean = checkRequest(sanitized)
const dirty = checkRequest(prePatch)

const stillBroken = clean.filter(c => c.problem)
assert.deepEqual(
  stillBroken.map(c => `${c.label}: ${c.problem}`),
  [],
  'a sanitized request must pass every check',
)

// Every check must be reachable — one that can never fire would silently pass forever.
const missed = dirty.filter(c => !c.problem).map(c => c.label)
assert.deepEqual(missed, [], 'these checks failed to flag a pre-patch request')

assert.equal(clean.length, dirty.length)
console.log(`ok — ${clean.length} checks pass a sanitized request and all reject a pre-patch one`)
