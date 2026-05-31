/**
 * Main setup wizard — orchestrates the full onboarding flow.
 *
 * Step 1: Feishu app registration (QR code → auto-create bot)
 * Step 2: Cursor API key (browser open + paste)
 * Step 3: Default workspace path
 * Step 4: Save config + optionally start daemon
 */
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { saveConfig } from '../config/store.js';

function prompt(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function printBanner() {
  console.log('\n' + '═'.repeat(50));
  console.log('        cursor-feishu-bridge setup');
  console.log('═'.repeat(50));
  console.log('通过飞书远程操控 Cursor Agent');
  console.log('约 2 分钟完成配置\n');
}

function printSuccess() {
  console.log('═'.repeat(50));
  console.log('  ✓ 配置完成！');
  console.log('');
  console.log('  现在去飞书私信你的机器人：');
  console.log('  「帮我分析当前项目的代码结构」');
  console.log('');
  console.log('  其他命令：');
  console.log('    cursor-feishu-bridge start   # 后台守护进程');
  console.log('    cursor-feishu-bridge stop    # 停止');
  console.log('    cursor-feishu-bridge status  # 查看状态');
  console.log('═'.repeat(50) + '\n');
}

export async function runSetupWizard(): Promise<void> {
  printBanner();

  // ── Step 1: Feishu ────────────────────────────────────────────────────────
  const { setupFeishu } = await import('./feishu.js');
  const feishu = await setupFeishu();

  // ── Step 2: Cursor API Key ────────────────────────────────────────────────
  const { setupCursor } = await import('./cursor.js');
  const cursor = await setupCursor();

  // ── Step 3: Default workspace ─────────────────────────────────────────────
  console.log('[3/3] 设置默认工作区');
  console.log('─'.repeat(48));
  const defaultCwd = await prompt('默认工作区路径', process.cwd());
  const expandedCwd = defaultCwd.replace(/^~/, os.homedir());
  const resolvedCwd = path.resolve(expandedCwd);
  console.log(`\n✓ 工作区：${resolvedCwd}\n`);

  // ── Save ──────────────────────────────────────────────────────────────────
  saveConfig({ feishu, cursor, defaultCwd: resolvedCwd });

  printSuccess();
}
