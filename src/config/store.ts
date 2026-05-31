/**
 * Config file store — ~/.cursor-feishu/config.json
 *
 * Stores Feishu app credentials, Cursor API key, and user preferences.
 * The file is written with mode 0600 (owner-read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.cursor-feishu');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  /** 'feishu' for mainland China, 'lark' for international */
  tenant: 'feishu' | 'lark';
}

export interface CursorConfig {
  apiKey: string;
  model: string;
}

export interface BridgeConfig {
  feishu: FeishuConfig;
  cursor: CursorConfig;
  defaultCwd: string;
  preferences?: {
    requireMentionInGroup?: boolean;
    showToolCalls?: boolean;
  };
}

export type PartialBridgeConfig = Partial<{
  feishu: Partial<FeishuConfig>;
  cursor: Partial<CursorConfig>;
  defaultCwd: string;
  preferences: BridgeConfig['preferences'];
}>;

export function isComplete(cfg: PartialBridgeConfig): cfg is BridgeConfig {
  return (
    typeof cfg.feishu?.appId === 'string' && cfg.feishu.appId.length > 0 &&
    typeof cfg.feishu?.appSecret === 'string' && cfg.feishu.appSecret.length > 0 &&
    typeof cfg.cursor?.apiKey === 'string' && cfg.cursor.apiKey.length > 0 &&
    typeof cfg.defaultCwd === 'string' && cfg.defaultCwd.length > 0
  );
}

export function loadConfig(): PartialBridgeConfig {
  try {
    const text = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(text) as PartialBridgeConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: PartialBridgeConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const existing = loadConfig();
  const merged = deepMerge(existing, cfg);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      result[k] = deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}
