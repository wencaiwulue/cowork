import type { McpbManifest } from '@anthropic-ai/mcpb'
import { errorMessage } from '../errors.js'
import { jsonParse } from '../slowOperations.js'

type McpbRuntime = {
  vAny: {
    McpbManifestSchema: {
      safeParse(manifest: unknown):
        | { success: true; data: McpbManifest }
        | {
            success: false
            error: {
              flatten(): {
                fieldErrors: Record<string, string[] | undefined>
                formErrors?: string[]
              }
            }
          }
    }
  }
}

async function loadMcpbRuntime(): Promise<McpbRuntime> {
  const mod = (await import('@anthropic-ai/mcpb')) as unknown as
    | McpbRuntime
    | { default?: McpbRuntime }
  const runtime = 'default' in mod && mod.default ? mod.default : mod
  return runtime as McpbRuntime
}

/**
 * Parses and validates a DXT manifest from a JSON object.
 *
 * Lazy-imports @anthropic-ai/mcpb: that package uses zod v3 which eagerly
 * creates 24 .bind(this) closures per schema instance (~300 instances between
 * schemas.js and schemas-loose.js). Deferring the import keeps ~700KB of bound
 * closures out of the startup heap for sessions that never touch .dxt/.mcpb.
 */
export async function validateManifest(
  manifestJson: unknown,
): Promise<McpbManifest> {
  const mcpb = await loadMcpbRuntime()
  const parseResult = mcpb.vAny.McpbManifestSchema.safeParse(manifestJson)

  if (parseResult.success === false) {
    const errors = parseResult.error.flatten()
    const errorMessages = [
      ...Object.entries(errors.fieldErrors).map(
        ([field, errs]) => `${field}: ${errs?.join(', ')}`,
      ),
      ...(errors.formErrors || []),
    ]
      .filter(Boolean)
      .join('; ')

    throw new Error(`Invalid manifest: ${errorMessages}`)
  }

  return parseResult.data
}

/**
 * Parses and validates a DXT manifest from raw text data.
 */
export async function parseAndValidateManifestFromText(
  manifestText: string,
): Promise<McpbManifest> {
  let manifestJson: unknown

  try {
    manifestJson = jsonParse(manifestText)
  } catch (error) {
    throw new Error(`Invalid JSON in manifest.json: ${errorMessage(error)}`)
  }

  return validateManifest(manifestJson)
}

/**
 * Parses and validates a DXT manifest from raw binary data.
 */
export async function parseAndValidateManifestFromBytes(
  manifestData: Uint8Array,
): Promise<McpbManifest> {
  const manifestText = new TextDecoder().decode(manifestData)
  return parseAndValidateManifestFromText(manifestText)
}

/**
 * Generates an extension ID from author name and extension name.
 * Uses the same algorithm as the directory backend for consistency.
 */
export function generateExtensionId(
  manifest: McpbManifest,
  prefix?: 'local.unpacked' | 'local.dxt',
): string {
  const sanitize = (str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_.]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')

  const authorName = manifest.author.name
  const extensionName = manifest.name

  const sanitizedAuthor = sanitize(authorName)
  const sanitizedName = sanitize(extensionName)

  return prefix
    ? `${prefix}.${sanitizedAuthor}.${sanitizedName}`
    : `${sanitizedAuthor}.${sanitizedName}`
}
