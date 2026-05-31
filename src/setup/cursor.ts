/**
 * Cursor API Key setup wizard.
 *
 * 1. Opens cursor.com/dashboard/integrations in the browser
 * 2. Prompts user to paste the key (masked input)
 * 3. Validates the key by checking API connectivity
 */
import readline from 'node:readline';
import open from 'open';
import { Agent, CursorAgentError } from '@cursor/sdk';
import type { CursorConfig } from '../config/store.js';

const DASHBOARD_URL = 'https://cursor.com/dashboard/integrations';
const DEFAULT_MODEL = 'composer-2.5';

/** Read a line from stdin with optional masking (replaces chars with *). */
function promptMasked(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write(question);
    let value = '';

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        rl.close();
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(0);
      } else if (char === '\u007f' || char === '\b') {
        // Backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        value += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

/** Validate the API key by making a minimal SDK call. */
async function validateKey(apiKey: string, model: string): Promise<boolean> {
  try {
    await using agent = await Agent.create({
      apiKey,
      model: { id: model },
      local: { cwd: process.cwd() },
    });
    // Immediately dispose — just checking auth.
    void agent;
    return true;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      return false;
    }
    // Network errors etc — assume valid to not block setup
    return true;
  }
}

/** Interactive mode — prompts the user via stdin. */
export async function setupCursor(): Promise<CursorConfig> {
  console.log('[2/3] 连接 Cursor 账号');
  console.log('─'.repeat(48));

  console.log('正在打开浏览器...\n');
  await open(DASHBOARD_URL).catch(() => {
    console.log(`  请手动打开：${DASHBOARD_URL}`);
  });

  console.log(`  → cursor.com/dashboard/integrations`);
  console.log(`  1. 点击 "Create API Key"`);
  console.log(`  2. 复制生成的 Key\n`);

  let apiKey = '';
  let attempts = 0;

  while (attempts < 3) {
    apiKey = await promptMasked('  请粘贴 Cursor API Key: ');
    apiKey = apiKey.trim();

    if (!apiKey) {
      console.log('  ✗ Key 不能为空，请重试。');
      attempts++;
      continue;
    }

    if (!apiKey.startsWith('cursor_')) {
      console.log('  ⚠ Key 格式看起来不对（应以 cursor_ 开头），仍然继续...');
    }

    process.stdout.write('  正在验证...');
    const valid = await validateKey(apiKey, DEFAULT_MODEL);
    if (valid) {
      process.stdout.write(' ✓\n');
      break;
    } else {
      process.stdout.write('\n  ✗ Key 验证失败，请检查后重试。\n');
      attempts++;
    }
  }

  if (!apiKey) {
    console.error('\n✗ 未能获取有效的 Cursor API Key，请重新运行 setup。');
    process.exit(1);
  }

  console.log(`\n✓ Cursor API Key 已保存\n`);
  return { apiKey, model: DEFAULT_MODEL };
}

/**
 * Non-interactive mode — accepts the key directly.
 * Used by AI agents: `cursor-feishu-bridge cursor init --key <key>`
 * Outputs JSON to stdout on success or failure.
 */
export async function setupCursorWithKey(apiKey: string): Promise<CursorConfig> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    process.stdout.write(JSON.stringify({ status: 'error', message: 'API key is empty' }) + '\n');
    process.exit(1);
  }

  const valid = await validateKey(trimmed, DEFAULT_MODEL);
  if (!valid) {
    process.stdout.write(JSON.stringify({
      status: 'error',
      message: 'API key validation failed — check key at cursor.com/dashboard/integrations',
    }) + '\n');
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ status: 'ok', model: DEFAULT_MODEL }) + '\n');
  return { apiKey: trimmed, model: DEFAULT_MODEL };
}
