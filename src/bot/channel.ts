/**
 * Channel — one per Feishu chat.
 *
 * Manages the full lifecycle of a single user message:
 *   receive → throttle/preempt → create/resume Agent → stream card → done
 *
 * Preemption: if a new message arrives while a run is in progress,
 * the running run is cancelled and a new one starts with the merged prompt.
 */
import type { AgentAdapter, AgentRun } from '../agent/types.js';
import { CardRenderer, type RunCardState } from '../card/renderer.js';
import {
  getSession,
  getSessionCwd,
  setSession,
  updateAgentId,
} from '../session/manager.js';
import { log } from '../core/logger.js';

const CARD_PATCH_INTERVAL_MS = 400;

export class Channel {
  private chatId: string;
  private adapter: AgentAdapter;
  private card: CardRenderer;

  private currentRun: AgentRun | null = null;
  private pendingPrompt: string | null = null;
  private processing = false;

  constructor(chatId: string, adapter: AgentAdapter, card: CardRenderer) {
    this.chatId = chatId;
    this.adapter = adapter;
    this.card = card;
  }

  /** Enqueue a prompt. Preempts the current run if one is active. */
  async enqueue(prompt: string): Promise<void> {
    if (this.processing && this.currentRun) {
      log.info('channel', 'preempt', { chatId: this.chatId });
      this.pendingPrompt = prompt;
      await this.currentRun.stop();
      return;
    }
    await this.runPrompt(prompt);
  }

  async stop(): Promise<void> {
    if (this.currentRun) {
      await this.currentRun.stop();
    }
  }

  private async runPrompt(prompt: string): Promise<void> {
    this.processing = true;
    this.pendingPrompt = null;

    const { chatId, adapter, card } = this;
    const cwd = getSessionCwd(chatId);
    const existing = getSession(chatId);
    const sessionId = existing?.agentId || undefined;

    const state: RunCardState = {
      messageId: '',
      status: 'running',
      text: '',
      tools: [],
      inputTokens: 0,
      outputTokens: 0,
    };

    // Post initial card.
    state.messageId = await card.createRunCard(chatId, cwd);

    // Throttled card updater.
    let lastPatch = 0;
    const patch = async (final = false) => {
      const now = Date.now();
      if (!final && now - lastPatch < CARD_PATCH_INTERVAL_MS) return;
      lastPatch = now;
      await card.patchRunCard(state.messageId, state, cwd);
    };

    const run = adapter.run({ prompt, cwd, sessionId });
    this.currentRun = run;

    try {
      for await (const event of run.events) {
        switch (event.type) {
          case 'text':
            state.text += event.delta;
            log.info('channel', 'text-delta', { chatId, len: state.text.length });
            await patch();
            break;

          case 'thinking':
            // Optionally show thinking in a collapsed section.
            break;

          case 'tool_use':
            state.tools.push(`${event.name}(${JSON.stringify(event.input).slice(0, 80)})`);
            await patch();
            break;

          case 'tool_result':
            // Optionally append result preview.
            break;

          case 'usage':
            state.inputTokens += event.inputTokens ?? 0;
            state.outputTokens += event.outputTokens ?? 0;
            break;

          case 'done': {
            state.status = 'done';
            // Persist the new agentId for session resumption.
            if (event.nextSessionId) {
              if (existing) {
                updateAgentId(chatId, event.nextSessionId);
              } else {
                setSession(chatId, { agentId: event.nextSessionId, cwd, updatedAt: Date.now() });
              }
            }
            await patch(true);
            break;
          }

          case 'error':
            log.error('channel', 'run-error', { chatId, message: event.message });
            state.status = 'error';
            state.text += `\n\n❌ ${event.message}`;
            await patch(true);
            break;
        }
      }
    } catch (err) {
      log.error('channel', 'unexpected', { chatId, err: String(err) });
      state.status = 'error';
      state.text += `\n\n❌ 内部错误: ${String(err)}`;
      await patch(true);
    } finally {
      this.currentRun = null;
      this.processing = false;
    }

    // If a new message arrived while we were running, process it now.
    if (this.pendingPrompt) {
      const next = this.pendingPrompt;
      this.pendingPrompt = null;
      await this.runPrompt(next);
    }
  }
}
