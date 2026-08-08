import * as readline from 'node:readline'
import { type Interface } from 'node:readline'

import type { MigrationSource, MigrationSourceInfo } from './importConfig.js'

/**
 * CLI first-run migration prompt. Renders a single-select menu over the
 * detected migration sources and returns the user's choice, or 'skip' when
 * no input is available (non-TTY / EOF).
 *
 * Callers SHOULD check `process.stdout.isTTY` before calling and auto-skip
 * when false; this function additionally degrades to 'skip' on EOF / read
 * error so the contract "never blocks forever" is guaranteed.
 */
export async function promptMigrationChoice(
  sources: MigrationSourceInfo[],
): Promise<MigrationSource | 'skip'> {
  // Degrade gracefully when there is nothing to prompt.
  const available = sources.filter(s => s.exists && s.totalItemCount > 0)
  if (available.length === 0) return 'skip'

  const rl: Interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  try {
    // Print detected sources with their home dir and migratable item count.
    process.stdout.write('\nFirst-run setup — import existing settings?\n\n')
    available.forEach((s, idx) => {
      const idxLabel = idx + 1
      process.stdout.write(
        `  ${idxLabel}. From ${s.label}  (${s.homeDir}${s.globalFile ? ' + ' + s.globalFile : ''}) — ${s.totalItemCount} item(s)\n`,
      )
    })
    process.stdout.write(`  s. Skip — start fresh\n`)
    process.stdout.write(
      `\nChoose [1-${available.length}/s] (default 1, press Enter): `,
    )

    const { answer, eof } = await readLine(rl)

    // No input at all (stdin closed without a line) → skip, per spec
    // ("函数内若读不到输入默认 skip"). An empty Enter is NOT eof.
    if (eof) return 'skip'

    const trimmed = answer.trim().toLowerCase()

    if (trimmed === '') {
      // Enter = default first source.
      return available[0]!.source
    }
    if (trimmed === 's' || trimmed === 'n') {
      return 'skip'
    }
    if (trimmed === 'y') {
      return available[0]!.source
    }
    // Numeric selection.
    const num = Number.parseInt(trimmed, 10)
    if (Number.isInteger(num) && num >= 1 && num <= available.length) {
      return available[num - 1]!.source
    }
    // Unrecognized input → default to first source rather than re-prompting
    // (keeps the flow single-shot; matches the "never blocks" contract).
    return available[0]!.source
  } finally {
    rl.close()
  }
}

/**
 * Promise-wrapper around a single readline line event.
 * Returns { answer, eof }: eof=true when stdin closed without delivering a
 * line (used to distinguish a real empty Enter from "no input at all").
 */
function readLine(rl: Interface): Promise<{ answer: string; eof: boolean }> {
  return new Promise<{ answer: string; eof: boolean }>(resolve => {
    let settled = false
    const done = (answer: string, eof: boolean) => {
      if (!settled) {
        settled = true
        resolve({ answer, eof })
      }
    }
    // rl.question fires the callback with the line (including '') when the
    // user presses Enter; if stdin closes without a trailing newline, the
    // callback still fires with the partial line. Only when stdin closes
    // with no data at all does 'close' fire first.
    rl.question('', answer => done(answer, false))
    rl.once('close', () => done('', true))
  })
}
