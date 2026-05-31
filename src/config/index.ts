/**
 * Runtime config resolver.
 *
 * Priority order:
 *   1. Environment variables (for CI / Docker deployments)
 *   2. ~/.cursor-feishu/config.json (normal user setup)
 *
 * Throws if required values are missing.
 */
import { loadConfig, isComplete, type BridgeConfig } from './store.js';

export function getConfig(): BridgeConfig {
  // Environment variables override config file (allows CI usage).
  const fromEnv: Partial<BridgeConfig> = {};
  if (process.env['FEISHU_APP_ID'] && process.env['FEISHU_APP_SECRET']) {
    fromEnv.feishu = {
      appId: process.env['FEISHU_APP_ID'],
      appSecret: process.env['FEISHU_APP_SECRET'],
      tenant: (process.env['FEISHU_TENANT'] as 'feishu' | 'lark') ?? 'feishu',
    };
  }
  if (process.env['CURSOR_API_KEY']) {
    fromEnv.cursor = {
      apiKey: process.env['CURSOR_API_KEY'],
      model: process.env['CURSOR_MODEL'] ?? 'composer-2.5',
    };
  }
  if (process.env['DEFAULT_CWD']) {
    fromEnv.defaultCwd = process.env['DEFAULT_CWD'];
  }

  const fileConfig = loadConfig();
  const merged = { ...fileConfig, ...fromEnv };
  if (fromEnv.feishu) merged.feishu = fromEnv.feishu;
  if (fromEnv.cursor) merged.cursor = fromEnv.cursor;

  if (!isComplete(merged)) {
    console.error('\n✗ 配置不完整。请先运行：cursor-feishu-bridge setup\n');
    process.exit(1);
  }

  return merged;
}

export { isComplete, loadConfig, saveConfig, CONFIG_FILE } from './store.js';
export type { BridgeConfig, FeishuConfig, CursorConfig } from './store.js';
