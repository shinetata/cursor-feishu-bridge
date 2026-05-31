/**
 * Channel — one per Feishu chat.
 *
 * Lifecycle of a single user message:
 *   receive → (preempt prior run) → create/resume Cursor Agent →
 *   stream a live markdown transcript (思考 / 工具 / 回答) → persist agentId
 *
 * Rendering uses the SDK's `LarkChannel.stream({ markdown })`, which drives
 * the native `cardkit.cardElement.content` typewriter API — smooth, throttled,
 * serialized, and auto-rolls over when a card hits Feishu's element size cap.
 * The TranscriptComposer turns each agent event into an append-only delta.
 */
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import type { AgentAdapter, AgentRun } from '../agent/types.js';
import { TranscriptComposer } from '../card/transcript.js';
import { getSession, getSessionCwd, setSession, updateAgentId } from '../session/manager.js';
import { log } from '../core/logger.js';

export class Channel {
  private currentRun: AgentRun | null = null;
  private pendingPrompt: string | null = null;
  private processing = false;

  constructor(
    private readonly chatId: string,
    private readonly adapter: AgentAdapter,
    private readonly lark: LarkChannel,
  ) {}

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
    if (this.currentRun) await this.currentRun.stop();
  }

  private async runPrompt(prompt: string): Promise<void> {
    this.processing = true;
    this.pendingPrompt = null;

    const { chatId, adapter, lark } = this;
    const cwd = getSessionCwd(chatId);
    const existing = getSession(chatId);
    const sessionId = existing?.agentId || undefined;

    const run = adapter.run({ prompt, cwd, sessionId });
    this.currentRun = run;

    const composer = new TranscriptComposer();
    let fullText = '';        // mirror, for the no-streaming fallback path
    let nextSessionId: string | undefined;
    let sawError = false;

    const consume = async (emit: (chunk: string) => Promise<void>) => {
      for await (const event of run.events) {
        switch (event.type) {
          case 'thinking':
            await emit(composer.thinking(event.delta));
            break;
          case 'text':
            await emit(composer.answer(event.delta));
            break;
          case 'tool_use':
            await emit(composer.toolUse(event.name, event.input));
            break;
          case 'tool_result':
            await emit(composer.toolResult(event.output, event.isError));
            break;
          case 'usage':
            break;
          case 'done':
            nextSessionId = event.nextSessionId;
            break;
          case 'error':
            sawError = true;
            await emit(composer.error(event.message));
            break;
        }
      }
    };

    try {
      await lark.stream(chatId, {
        markdown: async (controller) => {
          await consume(async (chunk) => {
            if (!chunk) return;
            fullText += chunk;
            await controller.append(chunk);
          });
        },
      });
    } catch (err) {
      // Streaming path failed (e.g. missing cardkit permission, or it threw
      // before consuming any events). Degrade gracefully: drain whatever is
      // left and post the transcript as a single markdown message.
      log.warn('channel', 'stream-failed', { chatId, err: String(err) });
      try {
        if (!fullText) {
          await consume(async (chunk) => { fullText += chunk; });
        }
        const body = fullText.trim() || '（无输出）';
        await lark.send(chatId, { markdown: body });
      } catch (fallbackErr) {
        log.error('channel', 'fallback-failed', { chatId, err: String(fallbackErr) });
      }
    } finally {
      this.currentRun = null;
      this.processing = false;
    }

    if (nextSessionId) {
      if (existing) updateAgentId(chatId, nextSessionId);
      else setSession(chatId, { agentId: nextSessionId, cwd, updatedAt: Date.now() });
    }
    log.info('channel', 'run-complete', { chatId, error: sawError, textLen: fullText.length });

    if (this.pendingPrompt) {
      const next = this.pendingPrompt;
      this.pendingPrompt = null;
      await this.runPrompt(next);
    }
  }
}
