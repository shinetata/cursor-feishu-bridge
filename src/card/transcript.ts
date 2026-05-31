/**
 * TranscriptComposer — turns the normalized agent event stream into an
 * append-only markdown transcript, mirroring the Cursor app's chat flow:
 *
 *   🧠 思考  →  🔧 工具调用  →  💬 回答  (interleaved as they arrive)
 *
 * It is append-only by design: each method returns ONLY the new markdown
 * delta to append, so it pairs perfectly with the SDK's
 * `MarkdownStreamController.append()` (native `cardkit.cardElement.content`
 * typewriter animation). No full-card rebuilds, no rate-limit lag.
 */

type Section = 'none' | 'thinking' | 'tools' | 'answer';

/** Tool input fields worth surfacing inline, in priority order. */
const SALIENT_KEYS = [
  'target_file', 'file_path', 'path', 'relative_workspace_path',
  'command', 'query', 'pattern', 'search_term', 'url',
];

export class TranscriptComposer {
  private section: Section = 'none';
  private answerHeaderShown = false;

  thinking(delta: string): string {
    let out = '';
    if (this.section !== 'thinking') {
      out += this.gap();
      out += '🧠 *思考*\n\n';
      this.section = 'thinking';
    }
    return out + delta;
  }

  answer(delta: string): string {
    let out = '';
    if (this.section !== 'answer') {
      out += this.gap();
      if (!this.answerHeaderShown && (this.section === 'thinking' || this.section === 'tools')) {
        out += '💬 **回答**\n\n';
        this.answerHeaderShown = true;
      }
      this.section = 'answer';
    }
    return out + delta;
  }

  toolUse(name: string, input: unknown): string {
    let out = '';
    if (this.section !== 'tools') {
      out += this.gap();
      out += '🔧 **工具调用**';
      this.section = 'tools';
    }
    out += `\n\n• \`${name}\`${this.fmtArgs(input)}`;
    return out;
  }

  toolResult(output: string, isError: boolean): string {
    const p = preview(output);
    if (!p) return isError ? '  ❗' : '  ✓';
    return `\n  ${isError ? '❗' : '↳'} ${p}`;
  }

  error(message: string): string {
    return `${this.gap()}❌ ${message}`;
  }

  /** Separator between sections (nothing before the very first one). */
  private gap(): string {
    return this.section === 'none' ? '' : '\n\n';
  }

  private fmtArgs(input: unknown): string {
    if (!input || typeof input !== 'object') return '';
    const obj = input as Record<string, unknown>;
    const key = SALIENT_KEYS.find((k) => typeof obj[k] === 'string' && obj[k]);
    let s = key ? String(obj[key]) : JSON.stringify(obj);
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > 64) s = s.slice(0, 61) + '…';
    return s ? ` \`${s}\`` : '';
  }
}

/** First non-empty line of a tool result, collapsed and truncated. */
function preview(output: string): string {
  if (!output) return '';
  const first = output.split('\n').find((l) => l.trim()) ?? '';
  let s = first.replace(/\s+/g, ' ').trim();
  if (s.length > 80) s = s.slice(0, 77) + '…';
  return s;
}
