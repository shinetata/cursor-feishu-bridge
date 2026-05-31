/**
 * Feishu event handler.
 *
 * Uses @larksuiteoapi/node-sdk's createLarkChannel — the high-level abstraction
 * that handles WebSocket long-connect, dedup, normalization, and card actions.
 *
 * channel.on({ message, cardAction, reject }) routes the three event kinds
 * we care about to Channel or CommandRouter.
 */
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import type { AgentAdapter } from '../agent/types.js';
import { Channel } from './channel.js';
import { CardRenderer } from '../card/renderer.js';
import { handleCommand } from '../commands/router.js';
import { log } from '../core/logger.js';

export class BotHandler {
  private card: CardRenderer;
  private channels = new Map<string, Channel>();

  constructor(
    private readonly larkChannel: LarkChannel,
    private readonly adapter: AgentAdapter,
  ) {
    this.card = new CardRenderer(larkChannel);
  }

  /** Attach event listeners to the LarkChannel. */
  listen() {
    this.larkChannel.on({
      message: (msg) => void this.onMessage(msg).catch((err) =>
        log.error('handler', 'message-error', { err: String(err) })
      ),

      // Card action: "⏹ Stop" button or custom __cursor_cb callbacks.
      cardAction: (evt) => {
        const chatId = evt.chatId;
        const action = (evt.value as Record<string, unknown>)?.action;
        if (action === 'stop') {
          const ch = this.channels.get(chatId);
          if (ch) void ch.stop();
        }
        log.info('handler', 'card-action', { chatId, action });
      },

      reject: (evt) => {
        log.info('handler', 'reject', { chatId: evt.chatId, reason: evt.reason });
      },
    });
  }

  private getChannel(chatId: string): Channel {
    let ch = this.channels.get(chatId);
    if (!ch) {
      ch = new Channel(chatId, this.adapter, this.card);
      this.channels.set(chatId, ch);
    }
    return ch;
  }

  private async onMessage(msg: NormalizedMessage): Promise<void> {
    const chatId = msg.chatId;
    const msgType = msg.messageType;

    log.info('handler', 'receive', { chatId, msgType, messageId: msg.messageId });

    let prompt: string | null = null;

    if (msgType === 'text') {
      // NormalizedMessage.text contains the plain text, with @mentions stripped.
      prompt = (msg.text ?? '').trim();
    } else if (msgType === 'image' || msgType === 'file') {
      prompt = `[用户发送了一个 ${msgType === 'image' ? '图片' : '文件'}，本地路径稍后实现]`;
    }

    if (!prompt) return;

    const channel = this.getChannel(chatId);

    const wasCommand = await handleCommand(prompt, {
      chatId,
      card: this.card,
      stopCurrentRun: async () => { await channel.stop(); },
    });

    if (!wasCommand) {
      await channel.enqueue(prompt);
    }
  }
}
