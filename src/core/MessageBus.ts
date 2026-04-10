import { EventEmitter } from 'events';
import { AgentMessage } from '../types/agent';

export class MessageBus extends EventEmitter {
  private static instance: MessageBus;
  private messageQueue: AgentMessage[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): MessageBus {
    if (!MessageBus.instance) {
      MessageBus.instance = new MessageBus();
    }
    return MessageBus.instance;
  }

  /**
   * Publishes a message to the bus for delivery to intended recipients.
   * If receiver_id is 'ALL', the message is broadcast to all listeners.
   */
  public publish(message: AgentMessage) {
    console.log(`[MessageBus] Publishing: ${message.id} from ${message.sender_id} to ${message.receiver_id}`);
    
    // Store in historical queue
    this.messageQueue.push(message);
    
    // Emit generic message event
    this.emit('message', message);
    
    // Emit target-specific event for easier filtering
    if (message.receiver_id === 'ALL') {
      this.emit('broadcast', message);
    } else {
      this.emit(`to:${message.receiver_id}`, message);
    }

    // Emit sender-specific activity event
    this.emit(`from:${message.sender_id}`, message);
  }

  public getMessageHistory(conversationId: string): AgentMessage[] {
    return this.messageQueue.filter(m => m.context_metadata.conversation_id === conversationId);
  }

  public clearHistory() {
    this.messageQueue = [];
  }
}
