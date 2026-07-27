import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('StructuredIO types', () => {
  it('does not assign unknown environment variable values to process.env', () => {
    const result = spawnSync(
      join('/Users/fengcaiwen/test/claude-code', 'node_modules/.bin/tsc'),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--jsx',
        'react-jsx',
        '--baseUrl',
        '/Users/fengcaiwen/test/claude-code',
        '/Users/fengcaiwen/test/claude-code/src/cli/structuredIO.ts',
      ],
      { encoding: 'utf8' },
    )

    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
      /src\/cli\/structuredIO\.ts\(\d+,\d+\): error TS2322: Type 'unknown' is not assignable to type 'string'\./,
    )
  }, 60_000)
})
