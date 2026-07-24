import type {
  AttributionData,
  AttributionState,
} from './commitAttribution.js'

export function appendAttributionTrailer(value: string): string {
  return value
}

export function buildPRTrailers(
  _data: AttributionData,
  _state: AttributionState | undefined,
): string[] {
  return []
}
