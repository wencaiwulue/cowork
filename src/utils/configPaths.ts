import { join } from 'path'

import { getCwd } from './cwd.js'

/**
 * Central constants for kode configuration paths and memory filenames.
 *
 * These constants exist so the project-level config dir name and memory
 * filenames have a single grep target, preventing the scattered-literal drift
 * that caused the original claude-branding leak.
 */

/** Project-level config directory name, e.g. ``<project>/.kode/``. */
export const KODE_PROJECT_DIR_NAME = '.kode'

/** Managed (MDM) sub-directory name under the managed platform dir. */
export const KODE_MANAGED_SUBDIR = '.kode'

/** Per-directory + user memory filename. */
export const KODE_MD = 'KODE.md'

/** Per-directory local (gitignored) memory filename. */
export const KODE_LOCAL_MD = 'KODE.local.md'

/**
 * Returns the project-level config directory for the given cwd
 * (defaults to the current working directory).
 *
 * Example: ``getProjectConfigDir('/repo') === '/repo/.kode'``
 */
export function getProjectConfigDir(cwd: string = getCwd()): string {
  return join(cwd, KODE_PROJECT_DIR_NAME)
}
