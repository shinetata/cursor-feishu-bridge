/**
 * Feishu CardKit 2.0 renderer.
 *
 * Uses the LarkChannel's rawClient for API calls (send / patch).
 *
 * Card lifecycle:
 *   1. createRunCard()   — post initial "thinking" card, return messageId
 *   2. patchRunCard()    — called on each text/tool delta (throttled externally)
 *   3. finalizeCard()    — mark as done/error with final state
 */
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger.js';

export type CardStatus = 'running' | 'done' | 'error' | 'stopped';

export interface RunCardState {
  messageId: string;
  status: CardStatus;
  text: string;
  tools: string[];
  inputTokens: number;
  outputTokens: number;
}

function buildCardJson(state: RunCardState, cwd: string): string {
  const statusEmoji =
    state.status === 'running' ? '🔵' :
    state.status === 'done'    ? '✅' :
    state.status === 'error'   ? '❌' : '⏹';

  const statusLabel =
    state.status === 'running' ? '生成中...' :
    state.status === 'done'    ? '已完成' :
    state.status === 'error'   ? '出错'   : '已停止';

  const cwdShort = cwd.replace(process.env['HOME'] ?? '', '~');

  // In CardKit 2.0, the `action` wrapper tag is deprecated.
  // Buttons must be placed directly inside body.elements.
  const elements: object[] = [
    {
      tag: 'markdown',
      content: `${statusEmoji} **${statusLabel}** · \`${cwdShort}\``,
    },
    { tag: 'hr' },
    { tag: 'markdown', content: state.text || '_等待响应..._' },
  ];

  if (state.tools.length > 0) {
    elements.push(
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**工具调用 (${state.tools.length})**\n${state.tools.map((t) => `- \`${t}\``).join('\n')}`,
      },
    );
  }

  if (state.inputTokens > 0 || state.outputTokens > 0) {
    elements.push({
      tag: 'markdown',
      content: `_${state.inputTokens}↑ ${state.outputTokens}↓ tokens_`,
    });
  }

  if (state.status === 'running') {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'button',
      element_id: 'stop_btn',
      text: { tag: 'plain_text', content: '⏹ 停止' },
      type: 'danger',
      behaviors: [{ type: 'callback', value: { action: 'stop' } }],
    });
  }

  const card = {
    schema: '2.0',
    config: {
      streaming_mode: state.status === 'running',
      summary: { content: state.text.slice(0, 100) || statusLabel },
    },
    body: { elements },
  };
  return JSON.stringify(card);
}

export class CardRenderer {
  private channel: LarkChannel;

  constructor(channel: LarkChannel) {
    this.channel = channel;
  }

  async createRunCard(chatId: string, cwd: string): Promise<string> {
    const state: RunCardState = { messageId: '', status: 'running', text: '', tools: [], inputTokens: 0, outputTokens: 0 };
    const content = buildCardJson(state, cwd);

    const resp = await this.channel.rawClient.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'interactive', content },
    });

    const messageId = resp.data?.message_id ?? '';
    log.info('card', 'created', { chatId, messageId });
    return messageId;
  }

  async patchRunCard(messageId: string, state: RunCardState, cwd: string): Promise<void> {
    const content = buildCardJson(state, cwd);
    try {
      await this.channel.rawClient.im.message.patch({
        path: { message_id: messageId },
        data: { content },
      });
      log.info('card', 'patched', { messageId, status: state.status, textLen: state.text.length });
    } catch (err) {
      log.warn('card', 'patch-failed', { messageId, err: String(err) });
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.channel.rawClient.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
    });
  }
}
