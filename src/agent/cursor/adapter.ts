import { Agent, CursorAgentError } from '@cursor/sdk';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types.js';
import { log } from '../../core/logger.js';

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
    for await (const msg of run.stream()) {
      if (stopped) break;

      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            yield { type: 'text', delta: block.text };
          } else if (block.type === 'thinking') {
            yield { type: 'thinking', delta: block.thinking };
          } else if (block.type === 'tool_use') {
            yield { type: 'tool_use', name: block.name, input: block.input };
          }
        }
      }

      if (msg.type === 'tool') {
        const content = msg.result.content;
        const text = Array.isArray(content)
          ? content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
          : String(content);
        yield { type: 'tool_result', output: text, isError: msg.result.is_error ?? false };
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
