import { Agent, CursorAgentError } from '@cursor/sdk';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types.js';
import { log } from '../../core/logger.js';
import { ensureRipgrep } from './ripgrep.js';

/**
 * Cursor SDK adapter.
 *
 * Maps Cursor SDK streaming events to the normalized AgentEvent format.
 * Uses Agent.create() for new sessions and Agent.resume() to continue.
 *
 * The "sessionId" stored in SessionManager is actually the Cursor agentId
 * (e.g. "a1b2c3..."). After each run completes, we return the same agentId
 * so the next message can call Agent.resume() on it.
 */
export class CursorSdkAdapter implements AgentAdapter {
  readonly id = 'cursor-sdk';
  readonly displayName = 'Cursor Agent';

  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.model ?? 'composer-2.5';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await Agent.prompt('ping', {
        apiKey: this.apiKey,
        model: { id: this.defaultModel },
        local: { cwd: process.cwd() },
      });
      return true;
    } catch {
      return false;
    }
  }

  run(opts: AgentRunOptions): AgentRun {
    const { prompt, cwd, sessionId, model } = opts;
    const apiKey = this.apiKey;
    const chosenModel = model ?? this.defaultModel;

    // Collect the abort controller so stop() can cancel the run.
    let stopFn: (() => Promise<void>) | null = null;

    const events = createEventStream({
      prompt,
      cwd,
      agentId: sessionId,
      apiKey,
      model: chosenModel,
      onStop: (fn) => { stopFn = fn; },
    });

    return {
      events,
      async stop() {
        if (stopFn) await stopFn();
      },
    };
  }
}

async function* createEventStream(opts: {
  prompt: string;
  cwd: string;
  agentId: string | undefined;
  apiKey: string;
  model: string;
  onStop: (fn: () => Promise<void>) => void;
}): AsyncGenerator<AgentEvent> {
  const { prompt, cwd, agentId, apiKey, model, onStop } = opts;

  ensureRipgrep();

  let agent: Awaited<ReturnType<typeof Agent.create>> | null = null;
  let stopped = false;

  try {
    // Create or resume the Cursor agent.
    if (agentId) {
      log.info('cursor-sdk', 'resume', { agentId, cwd });
      agent = await Agent.resume(agentId, {
        apiKey,
        model: { id: model },
        local: { cwd },
      });
    } else {
      log.info('cursor-sdk', 'create', { model, cwd });
      agent = await Agent.create({
        apiKey,
        model: { id: model },
        local: { cwd },
      });
    }

    // Wire stop() through to the SDK run's cancel().
    let currentRun: Awaited<ReturnType<typeof agent.send>> | null = null;
    onStop(async () => {
      stopped = true;
      if (currentRun && currentRun.supports('cancel')) {
        await currentRun.cancel();
      }
      if (agent) {
        await (agent as unknown as { [Symbol.asyncDispose](): Promise<void> })[Symbol.asyncDispose]?.();
      }
    });

    const run = await agent.send(prompt);
    currentRun = run;

    log.info('cursor-sdk', 'run-started', { runId: run.id, agentId: agent.agentId });

    // Stream SDK events → normalized AgentEvent.
    //
    // Real @cursor/sdk message shapes (see node_modules/@cursor/sdk .../messages.d.ts):
    //   - assistant  → message.content: (TextBlock | ToolUseBlock)[]  (text deltas)
    //   - thinking   → top-level { text }  (reasoning deltas)
    //   - tool_call  → top-level { name, status, args, result }, emitted twice:
    //                  status 'running' (args) then 'completed' | 'error' (result)
    // Tool rendering is driven by `tool_call` (richer: status + result); the
    // ToolUseBlock inside assistant content is intentionally ignored to avoid
    // double-rendering the same call.
    for await (const msg of run.stream()) {
      if (stopped) break;

      switch (msg.type) {
        case 'assistant':
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              yield { type: 'text', delta: block.text };
            }
          }
          break;

        case 'thinking':
          if (msg.text) yield { type: 'thinking', delta: msg.text };
          break;

        case 'tool_call':
          if (msg.status === 'running') {
            yield { type: 'tool_use', name: msg.name, input: msg.args };
          } else if (msg.status === 'completed') {
            yield { type: 'tool_result', output: resultToText(msg.result), isError: false };
          } else if (msg.status === 'error') {
            yield { type: 'tool_result', output: resultToText(msg.result), isError: true };
          }
          break;

        default:
          break;
      }
    }

    // Wait for the run to terminate cleanly.
    const result = await run.wait();

    if (result.status === 'error') {
      yield { type: 'error', message: `Cursor Agent run failed (id=${result.id})` };
      return;
    }

    // Return the agentId so the session manager can resume next time.
    yield { type: 'done', nextSessionId: agent.agentId };

  } catch (err) {
    if (err instanceof CursorAgentError) {
      log.error('cursor-sdk', 'startup-error', { message: err.message, retryable: err.isRetryable });
      yield { type: 'error', message: `Cursor SDK error: ${err.message}` };
    } else {
      yield { type: 'error', message: `Unexpected error: ${String(err)}` };
    }
  } finally {
    if (agent) {
      try {
        await (agent as unknown as { [Symbol.asyncDispose](): Promise<void> })[Symbol.asyncDispose]?.();
      } catch {
        // ignore disposal errors
      }
    }
  }
}

/** Flatten a tool_call result (string | { content: [...] } | object) to text. */
function resultToText(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    const r = result as { content?: unknown; text?: unknown };
    if (Array.isArray(r.content)) {
      return r.content
        .filter((c): c is { type: string; text: string } =>
          !!c && typeof c === 'object' && (c as { type?: string }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string')
        .map((c) => c.text)
        .join('\n');
    }
    if (typeof r.text === 'string') return r.text;
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
