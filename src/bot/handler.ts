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

      // Card action: "⏹ Stop" button or custom callbacks.
      cardAction: (evt) => {
        const chatId = evt.chatId;
        const value = evt.action?.value as Record<string, unknown> | undefined;
        const action = value?.action;
        if (action === 'stop') {
          const ch = this.channels.get(chatId);
          if (ch) void ch.stop();
        }
        log.info('handler', 'card-action', { chatId, action: String(action) });
      },

      reject: (evt) => {
        log.info('handler', 'reject', { chatId: evt.chatId, reason: evt.reason });
      },
    });
  }

  private getChannel(chatId: string): Channel {
    let ch = this.channels.get(chatId);
    if (!ch) {
      ch = new Channel(chatId, this.adapter, this.larkChannel);
      this.channels.set(chatId, ch);
    }
    return ch;
  }

  private async onMessage(msg: NormalizedMessage): Promise<void> {
    const chatId = msg.chatId;

    log.info('handler', 'receive', {
      chatId,
      messageId: msg.messageId,
      rawContentType: msg.rawContentType,
      contentPreview: msg.content?.slice(0, 120),
    });

    let prompt: string | null = null;

    // NormalizedMessage.content is a JSON string from the Feishu API.
    // e.g. for text: '{"text":"hello"}', for post: '{"zh_cn":{"title":"...","content":[...]}}'
    try {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>;
      if (typeof parsed.text === 'string' && parsed.text.trim()) {
        prompt = parsed.text.trim();
      } else if (parsed.zh_cn || parsed.en_us) {
        // Rich text (post) — extract title and first paragraph text
        const block = (parsed.zh_cn ?? parsed.en_us) as { title?: string; content?: unknown[] };
        prompt = block.title ? `[富文本] ${block.title}` : '[富文本消息]';
      }
    } catch {
      // Non-JSON content — use as-is
      if (msg.content?.trim()) prompt = msg.content.trim();
    }

    // Fall back to resources (image / file / audio / video)
    if (!prompt && msg.resources?.length) {
      const types = msg.resources.map(r => r.type).join(', ');
      prompt = `[用户发送了 ${types}，当前版本暂不支持处理附件]`;
    }

    if (!prompt) {
      log.info('handler', 'skip-empty', { chatId, rawContentType: msg.rawContentType });
      return;
    }

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
