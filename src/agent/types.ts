/**
 * Normalized agent event stream — adapter-agnostic.
 * All adapters translate their native events into this shape.
 */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; output: string; isError: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'done'; nextSessionId?: string }
  | { type: 'error'; message: string };

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  /** Pass previous agentId to resume a conversation. */
  sessionId?: string;
  model?: string;
  stopGraceMs?: number;
}

export interface AgentRun {
  /** Normalized event stream. Yields events until done/error. */
  readonly events: AsyncIterable<AgentEvent>;
  stop(): Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  run(opts: AgentRunOptions): AgentRun;
}
