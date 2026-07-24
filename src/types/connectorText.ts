export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text?: string
  text?: string
  source?: string
  [key: string]: any
}

export type ConnectorTextDelta = any

export function isConnectorTextBlock(value: unknown): value is ConnectorTextBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'connector_text'
  )
}
