/**
 * Cross-compile the CLI for a foreign platform (e.g. macOS arm64 from a Linux
 * container). Two quirks force this to be a separate path from build-cli.mjs:
 *
 *  1. No single bun version can do both halves of the job here.
 *     - Bundling needs a recent bun: only 1.3.14+ resolves this snapshot, which
 *       references `feature()`-gated modules that were never leaked
 *       (../buddy/observer.js, UltraplanChoiceDialog, yolo-classifier-prompts/*).
 *       1.3.0 and 1.2.21 fail with "Could not resolve".
 *     - Cross-compiling needs an older bun: 1.3.14 and 1.3.13 SIGABRT (134) on
 *       every foreign --compile target, while 1.3.0 and 1.2.21 succeed. Not a
 *       download problem — pointing BUN_COMPILE_TARGET_TARBALL_URL at a local
 *       copy of @oven/bun-darwin-aarch64 aborts just the same.
 *     So: bundle with the new bun, compile the pre-resolved bundle with the old
 *     one. The bundle has no unresolved imports left, so the old bun copes.
 *
 *  2. The compile output must be staged on a local filesystem.
 *     Writing a compiled binary straight onto the virtiofs mount (/data, shared
 *     from the macOS host) yields a file of the right size containing nothing but
 *     zero bytes. Compiling into os.tmpdir() and copying afterwards is fine.
 *
 * Env vars:
 *   CLI_CROSS_TARGET       bun target triple           (default bun-darwin-arm64)
 *   CLI_CROSS_OUTFILE      final binary path           (default ./dist/claude-local)
 *   CLI_BUILD_BUN          bun used to bundle          (default bun)
 *   CLI_CROSS_COMPILE_BUN  bun used to --compile       (default bun-cross)
 */
import { copyFileSync, chmodSync, mkdtempSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { cliBuildArgs, resolveBuildMetadata } from './build-cli.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const target = process.env.CLI_CROSS_TARGET?.trim() || 'bun-darwin-arm64'
const outfile = process.env.CLI_CROSS_OUTFILE?.trim() || './dist/claude-local'
const bundleBun = process.env.CLI_BUILD_BUN?.trim() || 'bun'
const compileBun = process.env.CLI_CROSS_COMPILE_BUN?.trim() || 'bun-cross'

/** Reuse the canonical --define set, minus --compile and the outfile. */
function bundleArgs(outdir) {
  const args = cliBuildArgs(resolveBuildMetadata(), {})
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--compile') continue
    if (args[i] === '--outfile') {
      out.push('--outdir', outdir)
      i++ // skip the outfile value
      continue
    }
    out.push(args[i])
  }
  return out
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${cmd} not found on PATH`)
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} exited ${result.status}`)
  }
}

/** A zeroed header means the write was swallowed (see quirk 2 above). */
function assertNotZeroed(path) {
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(64)
  readSync(fd, head, 0, 64, 0)
  closeSync(fd)
  if (head.every(byte => byte === 0)) {
    throw new Error(`${path} starts with 64 zero bytes — the write did not land`)
  }
}

const staging = mkdtempSync(join(tmpdir(), 'cli-cross-'))
try {
  console.log(`cross-building CLI: target=${target} outfile=${outfile}`)
  console.log(`  bundle : ${bundleBun}`)
  run(bundleBun, bundleArgs(join(staging, 'bundle')), root)

  console.log(`  compile: ${compileBun} (staged in ${staging})`)
  const staged = join(staging, 'binary')
  run(
    compileBun,
    ['build', './cli.js', '--compile', `--target=${target}`, '--outfile', staged],
    join(staging, 'bundle'),
  )
  assertNotZeroed(staged)

  // resolve, not join: an absolute CLI_CROSS_OUTFILE must land where it says,
  // not get appended to the repo root.
  const final = resolve(root, outfile)
  copyFileSync(staged, final)
  chmodSync(final, 0o755)
  assertNotZeroed(final)
  console.log(`wrote ${outfile} (${statSync(final).size} bytes)`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
