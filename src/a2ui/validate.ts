/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Adapted from a2ui/specification/v1_0/eval/src/validator.ts.
 * Changes: re-pointed schema URIs from v1.0 to v0_9_1; removed v1.0-only
 * message types (callRendererFunction, agentFunctionResponse).
 *
 * AJV and ajv-formats are lazy-loaded via dynamic import so that a missing
 * optional dependency cannot break CLI startup. If either package is absent the
 * function returns { valid: false, errors: ['ajv or ajv-formats not available'] }.
 */

import serverToClientSchema from './schemas/server_to_client.json' assert { type: 'json' }
import clientToServerSchema from './schemas/client_to_server.json' assert { type: 'json' }
import commonTypesSchema from './schemas/common_types.json' assert { type: 'json' }
import catalogSchema from './schemas/catalogs/basic/catalog.json' assert { type: 'json' }

// ---------------------------------------------------------------------------
// AJV instance — initialised lazily on first call
// ---------------------------------------------------------------------------

let _ajvInstance: unknown = null
let _validateFn: ((msg: unknown) => boolean) | null = null
let _ajvLoadError: string | null = null

/** Base URI used by server_to_client.json $id */
const SERVER_TO_CLIENT_URI = 'https://a2ui.org/specification/v0_9/server_to_client.json'

/**
 * Lazily initialise AJV and register the v0_9_1 schemas.
 *
 * The schemas use relative $ref values such as `"catalog.json#/..."` and
 * `"common_types.json#/..."`. These are resolved relative to the $id of the
 * containing schema. Because the $id URIs are of the form
 * `https://a2ui.org/specification/v0_9/<filename>.json` (and the catalog is
 * `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`), the
 * relative refs resolve automatically once each schema is registered under its
 * own $id.  No manual URI rewriting is required.
 */
async function getAjvValidateFn(): Promise<{
  validate: (msg: unknown) => boolean
  ajv: unknown
} | null> {
  if (_ajvLoadError) return null
  if (_validateFn && _ajvInstance) {
    return { validate: _validateFn, ajv: _ajvInstance }
  }

  try {
    // Dynamic imports so a missing package cannot break CLI startup
    const [{ default: Ajv }, { default: addFormats }] = await Promise.all([
      import('ajv/dist/2020') as Promise<{ default: new (opts: unknown) => unknown }>,
      import('ajv-formats') as Promise<{ default: (ajv: unknown) => unknown }>,
    ])

    const ajv = new (Ajv as any)({ allErrors: true, strict: false }) as any
    ;(addFormats as any)(ajv)

    // Register each schema under its $id so cross-file $ref resolution works.
    // The $id values are the canonical URIs used in $ref across all four files.
    ajv.addSchema(commonTypesSchema, commonTypesSchema.$id)
    ajv.addSchema(catalogSchema, catalogSchema.$id)
    ajv.addSchema(serverToClientSchema, serverToClientSchema.$id)
    // client_to_server has no $id in the vendored file; register under a stable key
    ajv.addSchema(clientToServerSchema, 'https://a2ui.org/specification/v0_9/client_to_server.json')

    _ajvInstance = ajv
    _validateFn = ajv.getSchema(SERVER_TO_CLIENT_URI) as (msg: unknown) => boolean
    return { validate: _validateFn!, ajv }
  } catch (err: unknown) {
    _ajvLoadError =
      err instanceof Error ? err.message : String(err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates an array of A2UI messages against the v0_9_1 server_to_client
 * schema. Returns { valid: true, errors: [] } if all messages pass, otherwise
 * { valid: false, errors: [...] } with human-readable error strings.
 *
 * Gracefully degrades if AJV is unavailable: returns { valid: false, errors }
 * with a diagnostic message rather than throwing.
 */
export async function validateA2uiMessages(
  messages: unknown[],
): Promise<{ valid: boolean; errors: string[] }> {
  const ajvCtx = await getAjvValidateFn()
  if (!ajvCtx) {
    const reason = _ajvLoadError ?? 'ajv or ajv-formats not available'
    return { valid: false, errors: [`Validator unavailable: ${reason}`] }
  }

  const { ajv } = ajvCtx as { ajv: any; validate: unknown }
  const errors: string[] = []

  for (const message of messages) {
    // Smart validation: pick the most specific sub-schema to avoid noisy
    // oneOf diagnostics — same approach as the upstream v1.0 validator.
    const schemaUri = SERVER_TO_CLIENT_URI
    let validated = false

    const msg = message as Record<string, unknown>
    if (msg.createSurface) {
      validated = ajv.validate(`${schemaUri}#/$defs/CreateSurfaceMessage`, message)
    } else if (msg.updateComponents) {
      validated = ajv.validate(`${schemaUri}#/$defs/UpdateComponentsMessage`, message)
    } else if (msg.updateDataModel) {
      validated = ajv.validate(`${schemaUri}#/$defs/UpdateDataModelMessage`, message)
    } else if (msg.deleteSurface) {
      validated = ajv.validate(`${schemaUri}#/$defs/DeleteSurfaceMessage`, message)
    } else {
      // Unknown message type — fall back to top-level oneOf
      const validateFn = ajv.getSchema(schemaUri) as (m: unknown) => boolean
      validated = validateFn ? validateFn(message) : false
    }

    if (!validated) {
      const ajvErrors: unknown[] = ajv.errors ?? []
      for (const err of ajvErrors) {
        const e = err as { instancePath?: string; message?: string }
        errors.push(
          `${e.instancePath || '(root)'} ${e.message || 'validation error'}`,
        )
      }
      if (ajvErrors.length === 0) {
        errors.push(`Unknown message type: ${JSON.stringify(Object.keys(msg))}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
