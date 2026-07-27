export function sanitizeWebhookMessage<T>(message: T): T {
  return message
}

export function sanitizeInboundWebhookContent<T>(content: T): T {
  return sanitizeWebhookMessage(content)
}
