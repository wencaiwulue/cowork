export type QueueOperationMessage = {
  type: 'queue-operation'
  [key: string]: any
}
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'clear' | 'popAll'
export type MessageQueueOperation = QueueOperationMessage
