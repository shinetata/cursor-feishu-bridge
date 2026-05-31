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
  const statusLabel =
    state.status === 'running' ? '生成中...' :
    state.status === 'done'    ? '已完成' :
    state.status === 'error'   ? '出错'   : '已停止';

  const statusColor =
    state.status === 'running' ? 'blue' :
    state.status === 'done'    ? 'green' :
    state.status === 'error'   ? 'red'   : 'grey';

  const cwdShort = cwd.replace(process.env['HOME'] ?? '', '~');

  const elements: object[] = [
    {
      tag: 'column_set',
      flex_mode: 'stretch',
      columns: [
        {
          tag: 'column',
          elements: [{ tag: 'badge', text: { tag: 'plain_text', content: statusLabel }, color: statusColor }],
        },
        {
          tag: 'column',
          align: 'right',
          elements: [{ tag: 'plain_text', content: cwdShort }],
        },
      ],
    },
    { tag: 'hr' },
    { tag: 'markdown', content: state.text || '_等待响应..._' },
  ];

  if (state.tools.length > 0) {
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: { elements: [{ tag: 'plain_text', content: `工具调用 (${state.tools.length})` }] },
      elements: state.tools.map((t) => ({ tag: 'markdown', content: `\`${t}\`` })),
    });
  }

  const footerEls: object[] = [];
  if (state.status === 'running') {
    footerEls.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '⏹ 停止' },
      type: 'danger',
      behaviors: [{ type: 'callback', value: { __cursor_cb: true, action: 'stop' } }],
    });
  }
  if (state.inputTokens > 0 || state.outputTokens > 0) {
    footerEls.push({ tag: 'plain_text', content: `${state.inputTokens}↑ ${state.outputTokens}↓ tokens` });
  }
  if (footerEls.length > 0) {
    elements.push({ tag: 'hr' }, { tag: 'action', elements: footerEls });
  }

  const card = {
    schema: '2.0',
    config: { summary: { content: state.text.slice(0, 100) || statusLabel } },
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
