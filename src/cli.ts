#!/usr/bin/env node
/**
 * cursor-feishu-bridge CLI
 *
 * Human usage:    cursor-feishu-bridge setup
 * Agent usage:    see INSTALL.md
 */
import { program } from 'commander';
import { Domain, LoggerLevel, createLarkChannel } from '@larksuiteoapi/node-sdk';
import { getConfig, loadConfig, isComplete } from './config/index.js';
import { CursorSdkAdapter } from './agent/index.js';
import { BotHandler } from './bot/handler.js';
import { log } from './core/logger.js';

program
  .name('cursor-feishu-bridge')
  .description('通过飞书远程操控 Cursor Agent')
  .version('0.1.0');

// ═══════════════════════════════════════════════════════════════════════════════
// Human-facing: setup wizard (all-in-one interactive)
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('setup')
  .description('首次配置向导（交互式，适合人工操作）')
  .action(async () => {
    const { runSetupWizard } = await import('./setup/wizard.js');
    await runSetupWizard();
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('是否立即启动为后台服务？[Y/n]: ', async (ans) => {
      rl.close();
      if (!ans.trim() || ans.trim().toLowerCase() === 'y') {
        const { serviceStart } = await import('./daemon/service.js');
        serviceStart();
      } else {
        console.log('\n手动启动：cursor-feishu-bridge start\n');
      }
    });
  });

// ═══════════════════════════════════════════════════════════════════════════════
// Agent-facing: discrete setup commands (non-interactive, JSON output)
// See INSTALL.md for the agent installation guide.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * `cursor-feishu-bridge feishu init [--json]`
 *
 * --json  Agent mode: writes two NDJSON lines to stdout then exits.
 *   Line 1: {"status":"qr_ready","qr_url":"...","expires_in":300}
 *   Line 2: {"status":"complete","app_id":"cli_xxx","tenant":"feishu"}
 */
const feishuCmd = program.command('feishu').description('飞书机器人管理');

feishuCmd
  .command('init')
  .description('创建/重新配置飞书机器人（扫码自动注册）')
  .option('--json', '输出 NDJSON（供 AI Agent 使用）')
  .action(async (opts: { json?: boolean }) => {
    const { saveConfig } = await import('./config/store.js');
    if (opts.json) {
      const { setupFeishuJson } = await import('./setup/feishu.js');
      const feishu = await setupFeishuJson();
      saveConfig({ feishu });
    } else {
      const { setupFeishu } = await import('./setup/feishu.js');
      const feishu = await setupFeishu();
      saveConfig({ feishu });
    }
  });

/**
 * `cursor-feishu-bridge cursor init --key <key>`
 *
 * Validates and saves the Cursor API key.
 * Outputs: {"status":"ok","model":"composer-2.5"} on success.
 */
const cursorCmd = program.command('cursor').description('Cursor 账号管理');

cursorCmd
  .command('init')
  .description('设置 Cursor API Key')
  .option('--key <key>', '直接传入 API Key（供 AI Agent 使用）')
  .action(async (opts: { key?: string }) => {
    const { saveConfig } = await import('./config/store.js');
    if (opts.key) {
      const { setupCursorWithKey } = await import('./setup/cursor.js');
      const cursor = await setupCursorWithKey(opts.key);
      saveConfig({ cursor });
    } else {
      const { setupCursor } = await import('./setup/cursor.js');
      const cursor = await setupCursor();
      saveConfig({ cursor });
    }
  });

/**
 * `cursor-feishu-bridge workspace set --path <path>`
 *
 * Sets the default workspace path.
 */
const workspaceCmd = program.command('workspace').description('工作空间管理');

workspaceCmd
  .command('set')
  .description('设置默认工作目录')
  .requiredOption('--path <path>', '项目目录绝对路径')
  .action(async (opts: { path: string }) => {
    const fs = await import('node:fs');
    const resolvedPath = opts.path === '.' ? process.cwd() : opts.path;
    if (!fs.existsSync(resolvedPath)) {
      console.error(JSON.stringify({ status: 'error', message: `Path does not exist: ${resolvedPath}` }));
      process.exit(1);
    }
    const { saveConfig } = await import('./config/store.js');
    saveConfig({ defaultCwd: resolvedPath });
    console.log(JSON.stringify({ status: 'ok', defaultCwd: resolvedPath }));
  });

workspaceCmd
  .command('list')
  .description('列出所有已保存的工作空间')
  .action(async () => {
    const { listWorkspaces } = await import('./session/manager.js');
    const ws = listWorkspaces();
    console.log(JSON.stringify({ workspaces: ws }));
  });

// ═══════════════════════════════════════════════════════════════════════════════
// Daemon: start / stop / status / run / uninstall
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('run')
  .description('前台运行（调试 / 开发用）')
  .action(async () => {
    const existing = loadConfig();
    if (!isComplete(existing)) {
      console.log('未检测到完整配置，请先运行：cursor-feishu-bridge setup');
      process.exit(1);
    }
    await startBridge();
  });

program
  .command('start')
  .description('安装为 OS 守护进程并启动（开机自启）')
  .action(async () => {
    const existing = loadConfig();
    if (!isComplete(existing)) {
      console.error(JSON.stringify({
        status: 'error',
        message: 'Configuration incomplete. Run: cursor-feishu-bridge setup',
      }));
      process.exit(1);
    }
    const { serviceStart } = await import('./daemon/service.js');
    serviceStart();
  });

program
  .command('stop')
  .description('停止守护进程')
  .action(async () => {
    const { serviceStop } = await import('./daemon/service.js');
    serviceStop();
  });

program
  .command('status')
  .description('查看守护进程状态')
  .action(async () => {
    const { serviceStatus } = await import('./daemon/service.js');
    serviceStatus();
  });

program
  .command('uninstall')
  .description('卸载守护进程（不删除配置）')
  .action(async () => {
    const { serviceUninstall } = await import('./daemon/service.js');
    serviceUninstall();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge core
// ═══════════════════════════════════════════════════════════════════════════════

async function startBridge(): Promise<void> {
  const cfg = getConfig();

  log.info('bridge', 'start', { model: cfg.cursor.model, cwd: cfg.defaultCwd });

  const adapter = new CursorSdkAdapter({
    apiKey: cfg.cursor.apiKey,
    model: cfg.cursor.model,
  });

  const larkChannel = createLarkChannel({
    appId: cfg.feishu.appId,
    appSecret: cfg.feishu.appSecret,
    domain: cfg.feishu.tenant === 'lark' ? Domain.Lark : Domain.Feishu,
    loggerLevel: LoggerLevel.warn,
    policy: {
      dmMode: 'open',
      requireMention: cfg.preferences?.requireMentionInGroup ?? true,
      respondToMentionAll: false,
    },
  });

  const handler = new BotHandler(larkChannel, adapter);
  handler.listen();

  log.info('bridge', 'connecting', { appId: cfg.feishu.appId });
  await larkChannel.connect();

  console.log('\n✓ cursor-feishu-bridge 已启动，等待飞书消息...');
  console.log('  按 Ctrl+C 停止\n');

  const shutdown = async (sig: string) => {
    console.log(`\n[${sig}] 正在关闭...`);
    await larkChannel.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('bridge', 'unhandled-rejection', { reason: String(reason) });
  });

  await new Promise<never>(() => {});
}
